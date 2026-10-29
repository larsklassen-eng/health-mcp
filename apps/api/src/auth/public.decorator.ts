import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC = "auth:public";

/** Lets a controller or route be used without a session (health checks, sign-in). */
export const Public = () => SetMetadata(IS_PUBLIC, true);
