export const MAX_THUMBNAIL_BYTES: number;
export interface PreviewChunk {
  type: 'preview'; transfer_id: string; index: number; total: number; mime: 'image/jpeg'; data: string;
}
export interface PreviewState { total: number | null; parts: Map<number,string> }
export function splitPreview(base64: string, transferId: string): PreviewChunk[];
export function acceptPreviewChunk(state: PreviewState, message: PreviewChunk, expectedTransferId: string): string | null;
