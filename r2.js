import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
  }
});

export async function uploadArquivo(buffer, nomeArquivo, contentType) {
  const command = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET,
    Key: nomeArquivo,
    Body: buffer,
    ContentType: contentType
  });

  await s3.send(command);

  return {
    bucket: process.env.R2_BUCKET,
    key: nomeArquivo,
    urlInterna: `${process.env.R2_ENDPOINT}/${process.env.R2_BUCKET}/${nomeArquivo}`
  };
}
