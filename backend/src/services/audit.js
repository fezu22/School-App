import { Audit } from "../models/index.js";
export const audit = (user, action, entity, id, branchId) =>
  Audit.create({
    actor: user._id,
    action,
    entity,
    entityId: String(id),
    branchId,
  });
