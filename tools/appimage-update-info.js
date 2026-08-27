'use strict';

// AppImage update information + .zsync (#9659).
//
// electron-builder has no zsync support at all: neither app-builder-lib 26.x
// nor the app-builder Go binary it drives contains the string "zsync", and
// nothing writes the runtime's `.upd_info` ELF section. So our AppImages ship
// with an empty update-information field, which is what makes AppImageUpdate,
// AppImageLauncher, AM/AppMan and AppManager report them as non-updatable.
//
// This does the two things the AppImage spec asks for:
//
//  1. writes the update-information string into `.upd_info` -- 1024 zero bytes
//     the type-2 runtime reserves for exactly this;
//  2. runs `zsyncmake` to produce the `<AppImage>.zsync` control file those
//     tools fetch to download only the changed blocks.
//
// Both steps are skipped together (with a warning) when `zsyncmake` is missing,
// so a local `npm run dist` behaves exactly as before -- and we never ship an
// AppImage advertising a .zsync that was never built. CI installs zsync; see
// .github/workflows/build.yml.
//
// Wired up from electron-builder.yaml as two hooks resolved out of this one
// module (electron-builder looks up the hook name as a named export before
// falling back to the default export).

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const SECTION = '.upd_info';
const ELF_MAGIC = 0x7f454c46;

// AppImages we embedded update information into, so afterAllArtifactBuild knows
// which files still need their .zsync. Both hooks share this module instance:
// electron-builder require()s the resolved path, so Node's module cache returns
// the same exports object for both config keys.
const embedded = new Set();

let zsyncmake = null;
const hasZsyncmake = () => {
  if (zsyncmake === null) {
    // zsyncmake has no --version; any spawn that is not ENOENT proves it exists.
    zsyncmake = spawnSync('zsyncmake', ['-V'], { stdio: 'ignore' }).error === undefined;
  }
  return zsyncmake;
};

const readExact = (fd, length, position) => {
  const buf = Buffer.alloc(length);
  if (fs.readSync(fd, buf, 0, length, position) !== length) {
    throw new Error(`short read of ${length} bytes at offset ${position}`);
  }
  return buf;
};

// Minimal ELF64 little-endian section lookup. That covers every AppImage
// electron-builder can produce here (x64/arm64 runtimes); the 32-bit ia32 and
// armv7l runtimes fall through to `null` and are left untouched rather than
// mis-parsed.
const findSection = (fd, wanted) => {
  const header = Buffer.alloc(64);
  if (fs.readSync(fd, header, 0, 64, 0) !== 64) return null;
  if (header.readUInt32BE(0) !== ELF_MAGIC) return null;
  if (header[4] !== 2 || header[5] !== 1) return null; // not ELFCLASS64 + LSB

  const shoff = Number(header.readBigUInt64LE(0x28));
  const shentsize = header.readUInt16LE(0x3a);
  const shnum = header.readUInt16LE(0x3c);
  const shstrndx = header.readUInt16LE(0x3e);
  if (shoff === 0 || shnum === 0 || shentsize < 64 || shstrndx >= shnum) return null;

  const table = readExact(fd, shentsize * shnum, shoff);
  const entry = (i) => table.subarray(i * shentsize, (i + 1) * shentsize);
  const shstrtab = entry(shstrndx);
  const names = readExact(
    fd,
    Number(shstrtab.readBigUInt64LE(0x20)),
    Number(shstrtab.readBigUInt64LE(0x18)),
  );

  for (let i = 0; i < shnum; i++) {
    const section = entry(i);
    const start = section.readUInt32LE(0);
    const end = names.indexOf(0, start);
    if (names.toString('latin1', start, end === -1 ? undefined : end) === wanted) {
      return {
        offset: Number(section.readBigUInt64LE(0x18)),
        size: Number(section.readBigUInt64LE(0x20)),
      };
    }
  }
  return null;
};

/**
 * Writes `info` into the file's `.upd_info` section, NUL-padded to the section
 * size so the runtime reads it as a C string. In-place: the file keeps its size,
 * so the appended squashfs image and blockmap stay where they are.
 *
 * @returns true when written, false when the file has no such section.
 */
const embedUpdateInformation = (file, info) => {
  const payload = Buffer.from(info, 'utf8');
  const fd = fs.openSync(file, 'r+');
  try {
    const section = findSection(fd, SECTION);
    if (section == null) return false;
    if (payload.length >= section.size) {
      throw new Error(
        `update information is ${payload.length} bytes, ${SECTION} holds ${section.size - 1}`,
      );
    }
    const buf = Buffer.alloc(section.size);
    payload.copy(buf);
    fs.writeSync(fd, buf, 0, buf.length, section.offset);
  } finally {
    fs.closeSync(fd);
  }
  return true;
};

// https://github.com/AppImage/AppImageSpec/blob/master/draft.md#update-information
// The artifactName pattern carries no version, so the .zsync name is stable
// across releases and needs no glob -- each arch points at its own file.
const updateInformationFor = (appImage, repositoryUrl) => {
  const repo = /github\.com[/:]([^/]+)\/(.+?)(?:\.git)?$/.exec(repositoryUrl);
  if (repo == null) {
    throw new Error(`cannot derive owner/repo from repository url "${repositoryUrl}"`);
  }
  return `gh-releases-zsync|${repo[1]}|${repo[2]}|latest|${path.basename(appImage)}.zsync`;
};

// Runs before electron-builder hashes the artifact for latest-linux.yml and
// before it uploads it (packager emits artifactBuildCompleted, then
// artifactCreated), so the published sha512 covers the patched bytes.
exports.artifactBuildCompleted = (event) => {
  if (event.target == null || event.target.name !== 'appImage') return;

  if (!hasZsyncmake()) {
    console.warn(
      `[appimage] zsyncmake not found - shipping ${path.basename(event.file)} without update information`,
    );
    return;
  }

  const info = updateInformationFor(
    event.file,
    require('../package.json').repository.url,
  );
  if (!embedUpdateInformation(event.file, info)) {
    console.warn(
      `[appimage] no ${SECTION} section in ${path.basename(event.file)} - skipped`,
    );
    return;
  }
  embedded.add(event.file);
  console.log(`[appimage] embedded update information: ${info}`);
};

// Returned paths are uploaded next to the AppImage by the configured publisher.
exports.afterAllArtifactBuild = () => {
  const created = [];
  for (const file of embedded) {
    const out = `${file}.zsync`;
    // -u is the URL the .zsync points back at, resolved relative to the .zsync
    // itself; both land in the same GitHub release directory.
    execFileSync('zsyncmake', ['-u', path.basename(file), '-o', out, file], {
      stdio: 'inherit',
    });
    created.push(out);
  }
  embedded.clear();
  return created;
};

// exported for tools/appimage-update-info.test.js
exports._internal = { embedUpdateInformation, updateInformationFor, findSection };
