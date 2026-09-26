import { randomUUID } from 'node:crypto';
import { Audit } from "../models/index.js";
export const audit = (user, action, entity, id, branchId) =>
  Audit.create({
    immutableRef: randomUUID(),
    actor: user._id,
    action,
    entity,
    entityId: String(id),
    branchId,
  });
