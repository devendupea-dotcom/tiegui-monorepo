import { Buffer } from "node:buffer";

type ZipEntry = {
  fileName: string;
  data: string | Buffer;
  modifiedAt?: Date;
};

type CentralDirectoryRecord = {
  fileName: Buffer;
  crc32: number;
  size: number;
  localHeaderOffset: number;
  modifiedTime: number;
  modifiedDate: number;
};

const crcTable = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  crcTable[index] = value >>> 0;
}

function computeCrc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (let index = 0; index < data.length; index += 1) {
    const byte = data[index]!;
    crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function toDosDateTime(date: Date): { dosTime: number; dosDate: number } {
  const year = Math.max(1980, date.getFullYear());
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);

  const dosTime = (hours << 11) | (minutes << 5) | seconds;
  const dosDate = ((year - 1980) << 9) | (month << 5) | day;
  return { dosTime, dosDate };
}

function toBuffer(data: string | Buffer): Buffer {
  return Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
}

export function buildZipArchive(entries: ZipEntry[]): Buffer {
  const fileChunks: Buffer[] = [];
  const centralDirectory: CentralDirectoryRecord[] = [];

  let offset = 0;
  for (const entry of entries) {
    const fileName = Buffer.from(entry.fileName, "utf8");
    const data = toBuffer(entry.data);
    const crc32 = computeCrc32(data);
    const { dosTime, dosDate } = toDosDateTime(entry.modifiedAt || new Date());

    const localHeader = Buffer.alloc(30 + fileName.length);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0, 6); // flags
    localHeader.writeUInt16LE(0, 8); // compression method (store)
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc32, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(fileName.length, 26);
    localHeader.writeUInt16LE(0, 28);
    fileName.copy(localHeader, 30);

    fileChunks.push(localHeader, data);
    centralDirectory.push({
      fileName,
      crc32,
      size: data.length,
      localHeaderOffset: offset,
      modifiedTime: dosTime,
      modifiedDate: dosDate,
    });

    offset += localHeader.length + data.length;
  }

  const centralChunks: Buffer[] = [];
  let centralSize = 0;
  for (const record of centralDirectory) {
    const centralHeader = Buffer.alloc(46 + record.fileName.length);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0, 8); // flags
    centralHeader.writeUInt16LE(0, 10); // compression
    centralHeader.writeUInt16LE(record.modifiedTime, 12);
    centralHeader.writeUInt16LE(record.modifiedDate, 14);
    centralHeader.writeUInt32LE(record.crc32, 16);
    centralHeader.writeUInt32LE(record.size, 20);
    centralHeader.writeUInt32LE(record.size, 24);
    centralHeader.writeUInt16LE(record.fileName.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra length
    centralHeader.writeUInt16LE(0, 32); // comment length
    centralHeader.writeUInt16LE(0, 34); // disk number start
    centralHeader.writeUInt16LE(0, 36); // internal attrs
    centralHeader.writeUInt32LE(0, 38); // external attrs
    centralHeader.writeUInt32LE(record.localHeaderOffset, 42);
    record.fileName.copy(centralHeader, 46);

    centralChunks.push(centralHeader);
    centralSize += centralHeader.length;
  }

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(centralDirectory.length, 8);
  end.writeUInt16LE(centralDirectory.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...fileChunks, ...centralChunks, end]);
}

export function bufferToReadableStream(buffer: Buffer, chunkSize = 64 * 1024): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= buffer.length) {
        controller.close();
        return;
      }

      const end = Math.min(buffer.length, offset + chunkSize);
      controller.enqueue(buffer.subarray(offset, end));
      offset = end;
    },
  });
}
