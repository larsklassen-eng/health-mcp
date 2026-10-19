import { rm } from "node:fs/promises";
import path from "node:path";

import { resolveImagingDir } from "@health-mcp/db";
import { Inject, Injectable } from "@nestjs/common";

import { ENV } from "../config/config.module.js";
import type { Env } from "../config/env.js";

/**
 * Where the PNG slices of uploaded studies live: `<IMAGING_DIR>/<study>/<series>/<n>.png`.
 * The database only stores the counts; files are named by position.
 */
@Injectable()
export class ImagingStorage {
  readonly root: string;

  constructor(@Inject(ENV) env: Env) {
    this.root = resolveImagingDir(env);
  }

  studyDir(studyId: string): string {
    return path.join(this.root, studyId);
  }

  seriesDir(studyId: string, seriesId: string): string {
    return path.join(this.studyDir(studyId), seriesId);
  }

  imagePath(studyId: string, seriesId: string, position: number): string {
    return path.join(this.seriesDir(studyId, seriesId), `${position}.png`);
  }

  /** Deletes the images of these studies (after their rows are deleted). */
  async removeStudies(studyIds: string[]): Promise<void> {
    await Promise.all(
      studyIds.map((id) => rm(this.studyDir(id), { recursive: true, force: true })),
    );
  }
}
