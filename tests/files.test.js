import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileProblem, fileIcon, linkUrl, linkHost, FILE_TYPES } from '../files.js';

test('Excel, GeoGebra and MP4 files can be attached; other videos and macros cannot', () => {
  for (const name of ['marks.xlsx', 'circle.ggb', 'clip.mp4', 'Notes.PDF']) {
    assert.equal(fileProblem({ name, size: 10 }), '', name);
  }
  for (const name of ['film.mov', 'macro.xlsm', 'old.xls', 'run.exe']) {
    assert.match(fileProblem({ name, size: 10 }), /isn't a PDF/, name);
  }
  assert.equal(FILE_TYPES.mp4, 'video/mp4');
  assert.deepEqual(['a.xlsx', 'b.ggb', 'c.mp4', 'd.png'].map(fileIcon), ['XLS', 'GGB', 'VID', 'IMG']);
});

test('links: web addresses are tidied, anything else is refused', () => {
  assert.equal(linkUrl('https://www.youtube.com/watch?v=abc'), 'https://www.youtube.com/watch?v=abc');
  assert.equal(linkUrl('  desmos.com/calculator '), 'https://desmos.com/calculator');
  assert.equal(linkUrl('http://example.org'), 'http://example.org/');
  for (const bad of ['', 'hello', 'javascript:alert(1)', 'data:text/html,hi', 'ftp://x.org/f', 'mailto:a@b.com']) {
    assert.equal(linkUrl(bad), '', bad);
  }
  assert.equal(linkHost('https://www.youtube.com/watch?v=abc'), 'youtube.com');
  assert.equal(linkHost('nope'), '');
});
