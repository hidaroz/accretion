import type { Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "node:crypto";

export function bearerAuth(apiKey: string) {
  const keyBuffer = Buffer.from(apiKey);

  return (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers["authorization"];

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing or invalid Authorization header" });
      return;
    }

    const token = authHeader.slice(7);
    const tokenBuffer = Buffer.from(token);

    // Reject early if lengths differ (length is already observable in the current code)
    if (tokenBuffer.length !== keyBuffer.length || !timingSafeEqual(tokenBuffer, keyBuffer)) {
      res.status(403).json({ error: "Invalid API key" });
      return;
    }

    next();
  };
}
