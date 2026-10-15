import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { signRequest } from "@/app/lib/backups/s3";

// SigV4 against the worked example of the AWS S3 documentation (Authenticating Requests:
// Using the Authorization Header › "Example: GET Object"): same keys, date, request and
// signed headers, same expected signature.
describe("S3 SigV4", () => {
  it("matches the documented GET Object example", () => {
    const empty = createHash("sha256").update("").digest("hex");
    const headers = signRequest(
      "GET",
      new URL("https://examplebucket.s3.amazonaws.com/test.txt"),
      {
        region: "us-east-1",
        accessKey: "AKIAIOSFODNN7EXAMPLE",
        secretKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      },
      empty,
      new Date("2013-05-24T00:00:00Z"),
      { range: "bytes=0-9" },
    );
    expect(headers.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, " +
        "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, " +
        "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
  });
});
