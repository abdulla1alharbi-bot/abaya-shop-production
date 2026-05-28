import type { PrismaClient } from "@prisma/client";

type PrismaTx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
type NotifyInput = {
  targetRole?: string;
  userId?: string;
  type: string;
  title: string;
  message: string;
  link?: string;
};

export async function notify(db: PrismaClient | PrismaTx, input: NotifyInput): Promise<void> {
  await db.notification.create({
    data: {
      userId: input.userId ?? null,
      targetRole: input.targetRole ?? null,
      type: input.type,
      title: input.title,
      message: input.message,
      link: input.link ?? null,
    },
  });
}
