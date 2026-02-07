
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { Admin } from './models';
import connectDB from './db';

dotenv.config();

const seedAdmin = async () => {
    await connectDB();

    const username = 'admin';
    const password = process.env.ADMIN_PASSWORD || 'admin123';

    const existing = await Admin.findOne({ username });
    if (existing) {
        console.log('Admin already exists');
        process.exit(0);
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await Admin.create({ username, passwordHash });

    console.log(`Admin created. Username: ${username}, Password: ${password}`);
    process.exit(0);
};

seedAdmin();
