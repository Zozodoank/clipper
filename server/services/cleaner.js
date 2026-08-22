import fs from 'fs';
import path from 'path';

/**
 * Safely removes temporary frame directories and intermediate files.
 * @param {Array<string>} filePaths - Specific files to delete
 * @param {Array<string>} dirPaths - Specific directories to delete
 */
export function cleanupTempFiles(filePaths = [], dirPaths = []) {
  for (const filePath of filePaths) {
    try {
      if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`[Cleaner] Deleted temp file: ${filePath}`);
      }
    } catch (err) {
      console.warn(`[Cleaner] Could not delete temp file ${filePath}: ${err.message}`);
    }
  }

  for (const dirPath of dirPaths) {
    try {
      if (dirPath && fs.existsSync(dirPath)) {
        fs.rmSync(dirPath, { recursive: true, force: true });
        console.log(`[Cleaner] Deleted temp dir: ${dirPath}`);
      }
    } catch (err) {
      console.warn(`[Cleaner] Could not delete temp dir ${dirPath}: ${err.message}`);
    }
  }
}
