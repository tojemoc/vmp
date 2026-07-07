import {
  createStorageProviderFromEnv,
  uploadLocalDirectory,
  uploadLocalFile,
  verifyRemoteDirectory,
  type ObjectStorageProvider,
} from '@vmp/storage/node'

let cachedStorage: ObjectStorageProvider | null = null

export function getPipelineStorage(): ObjectStorageProvider {
  if (!cachedStorage) {
    cachedStorage = createStorageProviderFromEnv()
  }
  return cachedStorage
}

export async function uploadFileToStorage(localFile: string, key: string, label: string): Promise<void> {
  console.log(`[storage] ${label}: ${localFile} -> ${key}`)
  await uploadLocalFile(getPipelineStorage(), localFile, key)
}

export async function uploadDirectoryToStorage(localDir: string, keyPrefix: string, label: string): Promise<void> {
  console.log(`[storage] ${label}: ${localDir} -> ${keyPrefix}`)
  await uploadLocalDirectory(getPipelineStorage(), localDir, keyPrefix)
}

export async function verifyStorageDirectory(localDir: string, keyPrefix: string, label: string): Promise<void> {
  console.log(`[storage] verify ${label}: ${localDir} -> ${keyPrefix}`)
  await verifyRemoteDirectory(getPipelineStorage(), localDir, keyPrefix)
}

export function objectKey(...parts: string[]): string {
  return parts.filter(Boolean).join('/').replace(/\/+/g, '/')
}
