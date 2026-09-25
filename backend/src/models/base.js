import mongoose from "mongoose";
const { Schema } = mongoose;
const oid = { type: Schema.Types.ObjectId };
const model = (name, fields, indexes = []) => {
  const s = new Schema(fields, { timestamps: true });
  for (const index of indexes) s.index(...index);
  return mongoose.models[name] || mongoose.model(name, s);
};
export { Schema, oid, model };
