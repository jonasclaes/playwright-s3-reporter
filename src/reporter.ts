import {
  PutObjectCommand,
  PutObjectCommandInput,
  S3Client,
  paginateListObjectsV2,
} from "@aws-sdk/client-s3";
import type {
  AwsCredentialIdentity,
  Provider,
  Endpoint,
  EndpointV2,
  UserAgent,
} from "@smithy/types";
import type { Reporter } from "@playwright/test/reporter";
import { createReadStream } from "fs";
import { readdir } from "fs/promises";
import path from "path";
import mime from "mime";
import { Eta } from "eta";

/**
 * The mode used to determine which files/folders are listed in the
 * generated directory listing `index.html` files.
 */
export type UpdateBucketDirectoryMode = "newOnly" | "listExisting";

export interface UpdateBucketDirectoryOptions {
  /**
   * Flag to enable or disable generating `index.html` directory listing
   * files for every directory that files get uploaded to.
   * Optional. Defaults to false if not provided.
   * @default false
   */
  enabled: boolean;

  /**
   * The mode used to determine the contents of the generated directory
   * listings.
   * - `newOnly`: Only the files uploaded during this run are listed.
   * - `listExisting`: The bucket is queried for existing files/folders so
   *   that previously uploaded reports are listed alongside the new ones.
   * Optional. Defaults to `newOnly` if not provided.
   * @default "newOnly"
   */
  mode?: UpdateBucketDirectoryMode;

  /**
   * When set, and `mode` is `listExisting`, only existing objects that were
   * last modified within this many days are included in the directory
   * listings. Older objects are omitted.
   * Optional. If not provided, all existing objects are included.
   */
  daysToKeep?: number;
}

export interface S3ReporterOptions {
  /**
   * AWS credentials required for authentication.
   * @property {string} accessKeyId - AWS access key ID.
   * @property {string} secretAccessKey - AWS secret access key.
   */
  credentials: AwsCredentialIdentity | Provider<AwsCredentialIdentity>;

  /**
   * The endpoint URL of the S3 service.
   * Optional. If not specified, the default AWS endpoint is used.
   * @default s3.<region>.amazonaws.com
   */
  endpoint?:
    string | Endpoint | Provider<Endpoint> | EndpointV2 | Provider<EndpointV2>;

  /**
   * Flag to enable or disable SSL for the connection.
   * Optional. Defaults to true if not provided.
   * @default true
   */
  sslEnabled?: boolean;

  /**
   * AWS region where the S3 bucket is located.
   * Optional. If not specified, the default region is used.
   */
  region?: string | Provider<string>;

  /**
   * A custom user agent string to be used in requests to AWS services.
   * Optional.
   */
  customUserAgent?: string | UserAgent;

  /**
   * The maximum number of attempts to make for a request.
   * Optional. If not specified, the default retry strategy is used.
   */
  maxAttempts?: number | Provider<number>;

  /**
   * The name of the S3 bucket where reports will be uploaded.
   */
  bucketName: string;

  /**
   * The base key (prefix) under which the reports will be uploaded in the bucket.
   * Optional. If not provided, files are uploaded to the root of the bucket.
   */
  baseUploadKey?: string;

  /**
   * Flag to enable or disable the upload of test results.
   * Optional. Defaults to false if not provided.
   * @default false
   */
  uploadTestResults?: boolean;

  /**
   * Flag to enable or disable the upload of the report.
   * Optional. Defaults to false if not provided.
   * @default false
   */
  uploadReport?: boolean;

  /**
   * Options to control the generation of `index.html` directory listing
   * files, which make browsing the uploaded reports in a bucket much
   * easier (for example when static website hosting is enabled).
   * Optional. Disabled by default.
   */
  updateBucketDirectory?: UpdateBucketDirectoryOptions;
}

interface DirectoryListingNode {
  directories: Set<string>;
  files: Set<string>;
}

interface DirectoryListing {
  key: string;
  content: string;
}

const DIRECTORY_LISTING_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Index of /<%= it.directory %></title>
</head>
<body>
<h1>Index of /<%= it.directory %></h1>
<ul>
<% if (it.parent !== null) { %><li><a href="../">../</a></li><% } %>
<% it.directories.forEach(function(dir) { %><li><a href="<%= dir %>/"><%= dir %>/</a></li><% }) %>
<% it.files.forEach(function(file) { %><li><a href="<%= file %>"><%= file %></a></li><% }) %>
</ul>
</body>
</html>
`;

class S3Reporter implements Reporter {
  constructor(protected options: S3ReporterOptions) {}

  async onExit(): Promise<void> {
    console.log(`[${S3Reporter.name}] Discovering files...`);

    const {
      credentials,
      endpoint,
      sslEnabled,
      region,
      customUserAgent,
      maxAttempts,
      bucketName,
      baseUploadKey,
      uploadTestResults,
      uploadReport,
      updateBucketDirectory,
    } = this.options;

    const s3 = new S3Client({
      credentials,
      endpoint,
      forcePathStyle: true,
      tls: sslEnabled,
      region,
      customUserAgent,
      maxAttempts,
    });

    const files: string[] = [];

    if (uploadTestResults) {
      const testResultsFiles = await this.getFiles("test-results");
      files.push(...testResultsFiles);
      console.log(
        `[${S3Reporter.name}] Discovered ${testResultsFiles.length} files in test-results/.`,
      );
    }

    if (uploadReport) {
      const playwrightReportFiles = await this.getFiles("playwright-report");
      files.push(...playwrightReportFiles);
      console.log(
        `[${S3Reporter.name}] Discovered ${playwrightReportFiles.length} files in playwright-report/.`,
      );
    }

    console.log(`[${S3Reporter.name}] Uploading ${files.length} files...`);

    let totalUploadErrors = 0;

    const uploadedKeys: string[] = [];

    const uploads = files.map(async (filePath) => {
      const metaData: Record<string, string> = {};

      let sourceDirectory = "";

      if (filePath.includes("test-results")) {
        sourceDirectory = "test-results";
      }

      if (filePath.includes("playwright-report")) {
        sourceDirectory = "playwright-report";
      }

      const key = path
        .join(
          baseUploadKey ?? "",
          sourceDirectory,
          path.relative(sourceDirectory, filePath),
        )
        .split(/[\\/]/g)
        .join("/");

      try {
        const putObjectParams: PutObjectCommandInput = {
          Bucket: bucketName,
          Key: key,
          Body: createReadStream(filePath),
          Metadata: metaData,
          ContentType: mime.getType(filePath) ?? undefined,
        };

        const putObjectCommand = new PutObjectCommand(putObjectParams);
        const response = await s3.send(putObjectCommand);
        uploadedKeys.push(key);
        console.log(
          `[${S3Reporter.name}] File uploaded successfully: ${key} (${response.$metadata.httpStatusCode})`,
        );
      } catch (error) {
        console.error(`[${S3Reporter.name}] Error uploading file: `, error);
        totalUploadErrors += 1;
      }
    });

    await Promise.all(uploads);

    console.log(
      `[${S3Reporter.name}] Upload completed with ${totalUploadErrors} errors!`,
    );

    if (updateBucketDirectory?.enabled) {
      totalUploadErrors += await this.updateBucketDirectoryListings(
        s3,
        bucketName,
        baseUploadKey,
        uploadedKeys,
        updateBucketDirectory.mode ?? "newOnly",
        updateBucketDirectory.daysToKeep,
      );
    }
  }

  protected async updateBucketDirectoryListings(
    s3: S3Client,
    bucketName: string,
    baseUploadKey: string | undefined,
    uploadedKeys: string[],
    mode: UpdateBucketDirectoryMode,
    daysToKeep: number | undefined,
  ): Promise<number> {
    console.log(
      `[${S3Reporter.name}] Generating directory listings (mode: ${mode})...`,
    );

    let totalUploadErrors = 0;

    // eslint-disable-next-line no-useless-assignment
    let listings: DirectoryListing[] = [];

    try {
      listings = await this.generateDirectoryListings(
        s3,
        bucketName,
        baseUploadKey,
        uploadedKeys,
        mode,
        daysToKeep,
      );
    } catch (error) {
      console.error(
        `[${S3Reporter.name}] Error generating directory listings: `,
        error,
      );
      return totalUploadErrors + 1;
    }

    const uploads = listings.map(async ({ key, content }) => {
      try {
        const putObjectCommand = new PutObjectCommand({
          Bucket: bucketName,
          Key: key,
          Body: content,
          ContentType: "text/html",
        });
        const response = await s3.send(putObjectCommand);
        console.log(
          `[${S3Reporter.name}] Directory listing uploaded successfully: ${key} (${response.$metadata.httpStatusCode})`,
        );
      } catch (error) {
        console.error(
          `[${S3Reporter.name}] Error uploading directory listing: `,
          error,
        );
        totalUploadErrors += 1;
      }
    });

    await Promise.all(uploads);

    return totalUploadErrors;
  }

  protected async generateDirectoryListings(
    s3: S3Client,
    bucketName: string,
    baseUploadKey: string | undefined,
    uploadedKeys: string[],
    mode: UpdateBucketDirectoryMode,
    daysToKeep: number | undefined,
  ): Promise<DirectoryListing[]> {
    let keys = [...uploadedKeys];

    if (mode === "listExisting") {
      const existingKeys = await this.getExistingKeys(
        s3,
        bucketName,
        baseUploadKey,
        daysToKeep,
      );
      keys = Array.from(new Set([...keys, ...existingKeys]));
    }

    const normalizedBase = (baseUploadKey ?? "")
      .split(/[\\/]/g)
      .filter(Boolean)
      .join("/");

    const relativeKeys = keys
      .map((key) => key.split(/[\\/]/g).filter(Boolean).join("/"))
      .filter((key) => !normalizedBase || key.startsWith(`${normalizedBase}/`))
      .map((key) =>
        normalizedBase ? key.slice(normalizedBase.length + 1) : key,
      )
      .filter((key) => key.length > 0);

    const tree = this.buildDirectoryTree(relativeKeys);
    const eta = new Eta();

    const listings: DirectoryListing[] = [];

    for (const [dirPath, node] of tree.entries()) {
      const parentPath = dirPath === "" ? null : path.dirname(dirPath);

      const content = eta.renderString(DIRECTORY_LISTING_TEMPLATE, {
        directory: dirPath,
        parent: parentPath === "." ? "" : parentPath,
        directories: Array.from(node.directories).sort(),
        files: Array.from(node.files).sort(),
      });

      const key = path
        .join(normalizedBase, dirPath, "index.html")
        .split(/[\\/]/g)
        .join("/");

      listings.push({ key, content });
    }

    return listings;
  }

  protected buildDirectoryTree(
    keys: string[],
  ): Map<string, DirectoryListingNode> {
    const tree = new Map<string, DirectoryListingNode>();

    const ensureNode = (dirPath: string): DirectoryListingNode => {
      let node = tree.get(dirPath);
      if (!node) {
        node = { directories: new Set(), files: new Set() };
        tree.set(dirPath, node);
      }
      return node;
    };

    ensureNode("");

    for (const key of keys) {
      const segments = key.split("/").filter(Boolean);

      let currentPath = "";

      segments.forEach((segment, index) => {
        const isFile = index === segments.length - 1;
        const node = ensureNode(currentPath);

        if (isFile) {
          if (segment !== "index.html") {
            node.files.add(segment);
          }
        } else {
          node.directories.add(segment);
          currentPath = currentPath ? `${currentPath}/${segment}` : segment;
          ensureNode(currentPath);
        }
      });
    }

    return tree;
  }

  protected async getExistingKeys(
    s3: S3Client,
    bucketName: string,
    baseUploadKey: string | undefined,
    daysToKeep: number | undefined,
  ): Promise<string[]> {
    const keys: string[] = [];

    const cutoffDate = daysToKeep !== undefined ? new Date() : undefined;
    if (cutoffDate) {
      cutoffDate.setDate(cutoffDate.getDate() - (daysToKeep ?? 30));
    }

    const paginator = paginateListObjectsV2(
      { client: s3 },
      { Bucket: bucketName, Prefix: baseUploadKey },
    );

    for await (const page of paginator) {
      (page.Contents ?? []).forEach((object) => {
        if (!object.Key) {
          return;
        }

        if (
          cutoffDate &&
          object.LastModified &&
          object.LastModified < cutoffDate
        ) {
          return;
        }

        keys.push(object.Key);
      });
    }

    return keys;
  }

  protected async getFiles(directory: string): Promise<string[]> {
    const _directories = await readdir(directory, { withFileTypes: true });
    const _files = await Promise.all(
      _directories.map((_directory) => {
        const resolvedPath = path.resolve(directory, _directory.name);
        return _directory.isDirectory()
          ? this.getFiles(resolvedPath)
          : resolvedPath;
      }),
    );
    return Array.prototype.concat(..._files);
  }
}

export default S3Reporter;
