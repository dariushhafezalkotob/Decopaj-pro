
import mongoose, { Schema, Document } from 'mongoose';

export interface IAdmin extends Document {
    username: string;
    passwordHash: string;
}

const AdminSchema: Schema = new Schema({
    username: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
});

export const Admin = mongoose.model<IAdmin>('Admin', AdminSchema);

// Reuse interfaces from frontend types logic for consistency
const EntitySchema = new Schema({
    id: String,
    refTag: String,
    name: String,
    type: String,
    description: String,
    imageData: String,
    mimeType: String
});

const ShotSchema = new Schema({
    shot_id: String,
    plan_type: String,
    camera_specs: String,
    action_segment: String,
    relevant_entities: [String],
    image_url: String,
    visual_breakdown: Schema.Types.Mixed // Storing complex JSON as Mixed for flexibility
});

const ContinuityIssueSchema = new Schema({
    id: String,
    shotId: String,
    category: { type: String, enum: ['outfit', 'time', 'location', 'camera', 'lighting', 'other'] },
    severity: { type: String, enum: ['error', 'warning', 'info'] },
    message: String,
    evidence: String,
    suggestedFix: String,
    resolved: { type: Boolean, default: false }
});

const SequenceSchema = new Schema({
    id: String,
    title: String,
    script: String,
    status: { type: String, enum: ['draft', 'analyzed', 'storyboarded'] },
    assets: [EntitySchema],
    shots: [ShotSchema],
    continuityIssues: [ContinuityIssueSchema]
});

const ProjectSchema = new Schema({
    id: String,
    name: String,
    user_id: { type: Schema.Types.ObjectId, ref: 'Admin' }, // Multi-tenancy support
    globalAssets: [EntitySchema],
    globalCast: [EntitySchema], // Restored for legacy data recovery
    sequences: [SequenceSchema]
}, { timestamps: true });

export const Project = mongoose.model('Project', ProjectSchema);

const MediaSchema = new Schema({
    id: { type: String, required: true, unique: true },
    data: { type: String, required: true }, // Base64
    mimeType: { type: String, default: 'image/png' }
}, { timestamps: true });

export const Media = mongoose.model('Media', MediaSchema);
