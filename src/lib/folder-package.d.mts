export interface FolderPart { file: Blob; relativePath: string }
export interface FolderEntry { path: string; size: number; offset: number; type: string }
export function validateFolderPath(value: unknown): string[];
export function createFolderPackage(files: FolderPart[], folderName?: string): File;
export function readFolderManifest(blob: Blob): Promise<{ entries: FolderEntry[]; dataOffset: number }>;
export function extractFolderPackage(blob: Blob, rootDirectory: FileSystemDirectoryHandle): Promise<number>;
