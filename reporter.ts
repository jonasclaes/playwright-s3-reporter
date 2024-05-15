import {
  PutObjectCommand,
  PutObjectCommandInput,
  S3Client,
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
    | string
    | Endpoint
    | Provider<Endpoint>
    | EndpointV2
    | Provider<EndpointV2>;

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
}

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
          ContentType: mime.getType(filePath),
        };

        const putObjectCommand = new PutObjectCommand(putObjectParams);
        const response = await s3.send(putObjectCommand);
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
