import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { BlobServiceClient } from '@azure/storage-blob'

const CONN = process.env.AZURE_STORAGE_CONNECTION_STRING!
const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

const TEST_PDF_BASE64 = 'JVBERi0xLjQKMSAwIG9iago8PAovVHlwZSAvQ2F0YWxvZwovUGFnZXMgMiAwIFIKPj4KZW5kb2JqCjIgMCBvYmoKPDwKL1R5cGUgL1BhZ2VzCi9LaWRzIFszIDAgUl0KL0NvdW50IDEKPD4KZW5kb2JqCjMgMCBvYmoKPDwKL1R5cGUgL1BhZ2UKL1BhcmVudCAyIDAgUgovTWVkaWFCb3ggWzAgMCA2MTIgNzkyXQo+PgplbmRvYmoKeHJlZgowIDQKMDAwMDAwMDAwMCA2NTUzNSBmCjAwMDAwMDAwMDkgMDAwMDAgbgowMDAwMDAwMDU4IDAwMDAwIG4KMDAwMDAwMDExNSAwMDAwMCBuCnRyYWlsZXIKPDwKL1NpemUgNAovUm9vdCAxIDAgUgo+PgpzdGFydHhyZWYKMTkwCiUlRU9G'

// MT-30 — Object storage. Uploads a small PDF to an Azure Blob container in the
// existing storage account, reads it back, verifies the bytes round-trip, then
// cleans up. Proves the object-storage service (video/screenshots/PDFs).
export async function mt30(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: HEADERS }
  try {
    const svc = BlobServiceClient.fromConnectionString(CONN)
    const container = svc.getContainerClient('engine-assets')
    const created = await container.createIfNotExists()

    const blobName = `probe/mt30-${Date.now()}.pdf`
    const bytes = Buffer.from(TEST_PDF_BASE64, 'base64')
    const blob = container.getBlockBlobClient(blobName)
    await blob.upload(bytes, bytes.length, { blobHTTPHeaders: { blobContentType: 'application/pdf' } })

    // Read it back
    const dl = await blob.download()
    const chunks: Buffer[] = []
    for await (const c of dl.readableStreamBody as any) chunks.push(Buffer.from(c))
    const readBytes = Buffer.concat(chunks)
    const match = readBytes.length === bytes.length && readBytes.equals(bytes)

    await blob.deleteIfExists()

    return {
      status: 200, headers: HEADERS,
      jsonBody: {
        pass: match,
        detail: match
          ? `Uploaded ${bytes.length}B PDF to container 'engine-assets', read back identical bytes, deleted.`
          : `Byte mismatch: wrote ${bytes.length}, read ${readBytes.length}`,
        container: 'engine-assets',
        containerCreatedNow: created.succeeded,
        blobName,
        bytesWritten: bytes.length,
        bytesRead: readBytes.length,
        url: blob.url
      }
    }
  } catch (err) {
    return { status: 200, headers: HEADERS, jsonBody: { pass: false, detail: String(err) } }
  }
}

app.http('mt30', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', route: 'test/mt-30', handler: mt30 })
