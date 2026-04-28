declare module "pngjs" {
  export class PNG {
    static sync: {
      read(data: Buffer, options?: { checkCRC?: boolean }): PNG;
      write(png: PNG): Buffer;
    };
  }
}
