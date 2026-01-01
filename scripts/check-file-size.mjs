#!/usr/bin/env node

/**
 * Check for files exceeding maximum line count to enforce modularity
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const MAX_LINES = 500;
const EXTENSIONS = ['.ts', '.js', '.tsx', '.jsx'];
const EXCLUDE_PATTERNS = ['node_modules', 'dist', 'coverage', '.git'];

function getAllFiles(dir, fileList = []) {
    const files = readdirSync(dir);

    for (const file of files) {
        const filePath = join(dir, file);

        // Skip excluded directories
        if (EXCLUDE_PATTERNS.some(pattern => filePath.includes(pattern))) {
            continue;
        }

        if (statSync(filePath).isDirectory()) {
            getAllFiles(filePath, fileList);
        } else if (EXTENSIONS.includes(extname(file))) {
            fileList.push(filePath);
        }
    }

    return fileList;
}

function checkFileSize(filePath) {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').length;

    if (lines > MAX_LINES) {
        return { file: filePath, lines, maxLines: MAX_LINES };
    }

    return null;
}

function main() {
    const files = getAllFiles('.');
    const violations = [];

    for (const file of files) {
        const result = checkFileSize(file);
        if (result) {
            violations.push(result);
        }
    }

    if (violations.length > 0) {
        console.error(`\n❌ Found ${violations.length} file(s) exceeding ${MAX_LINES} lines:\n`);

        for (const { file, lines } of violations) {
            console.error(`  ${file}: ${lines} lines (exceeds limit by ${lines - MAX_LINES})`);
        }

        console.error(`\n💡 Consider refactoring large files into smaller, more focused modules.\n`);
        process.exit(1);
    }

    console.log(`✅ All files are under ${MAX_LINES} lines`);
}

main();
