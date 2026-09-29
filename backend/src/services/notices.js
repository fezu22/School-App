import { Notice, SchoolClass } from "../models/index.js";
import { classFilter } from "../middleware/auth.js";

// Notices visible to this user (their classes, or branch-wide in their branches).
export async function visibleNotices(user) {
  const classes = await SchoolClass.find(await classFilter(user));
  const branchIds = [...user.branchIds, ...classes.map((c) => c.branchId)];
  const filter =
    user.role === "SUPER_ADMIN"
      ? {}
      : {
          $or: [
            { classId: { $in: classes.map((c) => c._id) } },
            { classId: null, branchId: { $in: branchIds } },
          ],
        };
  return Notice.find(filter).sort({ createdAt: -1 }).limit(100);
}
