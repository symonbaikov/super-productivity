'use strict';

// Guards the ELF section write behind the AppImage update information (#9659).
// A real AppImage is ~130 MB and only exists after a full electron-builder run,
// so this builds the smallest ELF64 that has a `.upd_info` section and checks we
// find and fill exactly it.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  _internal: { embedUpdateInformation, updateInformationFor, findSection },
} = require('./appimage-update-info.js');

const SECTION_SIZE = 1024;
// "\0.shstrtab\0.upd_info\0" - the offsets the section headers index into.
const NAMES = Buffer.from('\0.shstrtab\0.upd_info\0', 'latin1');
const SHSTRTAB_NAME = 1;
const UPD_INFO_NAME = 11;

const NAMES_OFF = 64;
const UPD_INFO_OFF = NAMES_OFF + NAMES.length;
const SHOFF = UPD_INFO_OFF + SECTION_SIZE;
const TRAILER = Buffer.from('squashfs-would-live-here');

const sectionHeader = (name, offset, size) => {
  const sh = Buffer.alloc(64);
  sh.writeUInt32LE(name, 0);
  sh.writeUInt32LE(1, 4); // SHT_PROGBITS
  sh.writeBigUInt64LE(BigInt(offset), 0x18);
  sh.writeBigUInt64LE(BigInt(size), 0x20);
  return sh;
};

const writeFakeElf = (file, { class64 = true } = {}) => {
  const header = Buffer.alloc(64);
  header.writeUInt32BE(0x7f454c46, 0);
  header[4] = class64 ? 2 : 1;
  header[5] = 1; // little endian
  header[6] = 1;
  header.writeBigUInt64LE(BigInt(SHOFF), 0x28);
  header.writeUInt16LE(64, 0x3a); // e_shentsize
  header.writeUInt16LE(3, 0x3c); // e_shnum
  header.writeUInt16LE(1, 0x3e); // e_shstrndx

  fs.writeFileSync(
    file,
    Buffer.concat([
      header,
      NAMES,
      Buffer.alloc(SECTION_SIZE),
      Buffer.alloc(64), // SHN_UNDEF
      sectionHeader(SHSTRTAB_NAME, NAMES_OFF, NAMES.length),
      sectionHeader(UPD_INFO_NAME, UPD_INFO_OFF, SECTION_SIZE),
      TRAILER, // stands in for the appended squashfs image + blockmap
    ]),
  );
};

const tmpFile = (name) => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'upd-')), name);

test('finds .upd_info and writes the update information NUL-padded, in place', () => {
  const file = tmpFile('fake.AppImage');
  writeFakeElf(file);
  const sizeBefore = fs.statSync(file).size;

  const info = 'gh-releases-zsync|owner|repo|latest|app-x86_64.AppImage.zsync';
  assert.equal(embedUpdateInformation(file, info), true);

  const written = fs.readFileSync(file);
  assert.equal(written.length, sizeBefore, 'must not resize the AppImage');
  assert.equal(
    written.toString('latin1', UPD_INFO_OFF, UPD_INFO_OFF + info.length),
    info,
  );
  assert.equal(written[UPD_INFO_OFF + info.length], 0, 'must be NUL-terminated');
  assert.ok(
    written
      .subarray(UPD_INFO_OFF + info.length, UPD_INFO_OFF + SECTION_SIZE)
      .every((b) => b === 0),
    'rest of the section must stay zeroed',
  );
  assert.equal(
    written.subarray(written.length - TRAILER.length).toString(),
    TRAILER.toString(),
    'appended payload must be untouched',
  );
});

test('leaves files without a .upd_info section alone', () => {
  const file = tmpFile('not-an-appimage');
  fs.writeFileSync(file, 'just some bytes');
  assert.equal(embedUpdateInformation(file, 'x'), false);
  assert.equal(fs.readFileSync(file, 'utf8'), 'just some bytes');
});

test('skips 32-bit ELFs rather than mis-parsing them', () => {
  const file = tmpFile('ia32.AppImage');
  writeFakeElf(file, { class64: false });
  assert.equal(findSection(fs.openSync(file, 'r'), '.upd_info'), null);
});

test('refuses update information that would overflow the section', () => {
  const file = tmpFile('big.AppImage');
  writeFakeElf(file);
  assert.throws(
    () => embedUpdateInformation(file, 'x'.repeat(SECTION_SIZE)),
    /holds 1023/,
  );
});

test('derives the gh-releases-zsync string from the repository url', () => {
  assert.equal(
    updateInformationFor(
      '/out/superProductivity-x86_64.AppImage',
      'git://github.com/super-productivity/super-productivity.git',
    ),
    'gh-releases-zsync|super-productivity|super-productivity|latest|superProductivity-x86_64.AppImage.zsync',
  );
  assert.throws(
    () => updateInformationFor('/out/a.AppImage', 'https://example.com/x'),
    /repository url/,
  );
});
