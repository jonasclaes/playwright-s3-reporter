![npm](https://img.shields.io/npm/v/playwright-s3-reporter?logo=npm)
![npm](https://img.shields.io/npm/dt/playwright-s3-reporter?logo=npm)
![Libraries.io dependency status for latest release](https://img.shields.io/librariesio/release/npm/playwright-s3-reporter?logo=npm)
![Sonar Violations (long format)](https://img.shields.io/sonar/violations/jonasclaes_playwright-s3-reporter?server=https%3A%2F%2Fsonarcloud.io&logo=sonarcloud)

# Playwright S3 Reporter

The Playwright S3 Reporter is a new and innovative tool designed for uploading test traces and reports to any S3-compatible service. This reporter is specifically created for use with Playwright tests, facilitating efficient and effective management of test data in the cloud.

## Features

- **Direct S3 Uploads**: Seamlessly upload test traces and reports to S3-compatible services.
- **Automated Test Data Handling**: Automates the process of storing test reports and traces in the cloud.
- **Lightweight**: Utilizes a single dependency (`@aws-sdk/client-s3`) to upload data.
- **Well-maintained Code**: Adheres to coding standards and continuously receives updates.

## Installation

Installing the Playwright S3 Reporter is a breeze. Simply run the following command:

```bash
npm install --save-dev playwright-s3-reporter
```

## Configuration

To configure the reporter, add it to your `playwright.config.ts` file. That's all you need to do to set it up!

Example `playwright.config.ts` file:

```typescript
...
reporter: [
    [
      'playwright-s3-reporter',
      {
        credentials: {
          accessKeyId: "abcd", // Required: Your AWS access key ID.
          secretAccessKey: "xyz", // Required: Your AWS secret access key.
        },
        endpoint: "http://playwright-s3.services.mycompany.example:9000", // Optional: The endpoint URL of the S3 service. Required for services other than AWS S3. Defaults to s3.<region>.amazonaws.com.
        sslEnabled: false, // Optional: Flag to enable or disable SSL for the connection. Defaults to true.
        region: "eu-west-rack-1", // Optional: AWS region where the S3 bucket is located.
        bucketName: "test", // Required: The name of the S3 bucket where reports will be uploaded.
        baseUploadKey: "tests/abcd/", // Optional: The base key (prefix) under which the reports will be uploaded in the bucket. Defaults to the root of the bucket.
        uploadTestResults: true, // Optional: Flag to enable or disable the upload of test results. Defaults to false.
        uploadReport: true, // Optional: Flag to enable or disable the upload of the Playwright report. Defaults to false.
      }
    ]
]
...
```

## Usage

Once installed and configured, all you have to do is run your tests:

```bash
# Run all tests
npx playwright test
```

The rest works like magic. You'll have the files uploaded to your S3 bucket.

## Dependencies

- **Required**: `@aws-sdk/client-s3` (for S3 interactions)
- **Peer Dependencies**: `@playwright/test`, `playwright-core` (usually already installed in a Playwright project)

## NPM Package

You can find the package on NPM at [playwright-s3-reporter](https://www.npmjs.com/package/playwright-s3-reporter).

## Support

For any issues, queries, or contributions, please refer to the official repository.

## License

Please refer to the license file in the repository for information on the usage terms and conditions.

**Happy Testing with Playwright and S3! 🚀**
