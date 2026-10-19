import { Global, Module } from "@nestjs/common";

import { ImagingStorage } from "../imaging/imaging-storage.js";
import { DatabaseService } from "./database.service.js";

/** The SQLite database, and the image files stored next to it. */
@Global()
@Module({
  providers: [DatabaseService, ImagingStorage],
  exports: [DatabaseService, ImagingStorage],
})
export class DatabaseModule {}
