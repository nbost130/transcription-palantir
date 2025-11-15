/**
 * 🔮 Transcription Palantir - File Utilities
 *
 * Shared file-related utility functions
 */

// =============================================================================
// MIME TYPE DETECTION
// =============================================================================

/**
 * Get MIME type from file extension
 * @param extension - File extension (without the dot)
 * @returns MIME type string
 */
export function getMimeType(extension: string): string {
  const mimeTypes: Record<string, string> = {
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    m4a: 'audio/mp4',
    flac: 'audio/flac',
    ogg: 'audio/ogg',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    avi: 'video/x-msvideo',
    webm: 'audio/webm',
    aac: 'audio/aac',
  };

  return mimeTypes[extension.toLowerCase()] || 'application/octet-stream';
}
