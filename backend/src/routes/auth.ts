
import { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { Admin, IAdmin } from '../models';

export default async function authRoutes(server: FastifyInstance) {

    server.post('/register', async (request: any, reply) => {
        // Hidden endpoint for initial setup or admin creation
        const { username, password } = request.body;
        if (!username || !password) return reply.code(400).send({ message: "Missing credentials" });

        const passwordHash = await bcrypt.hash(password, 10);
        try {
            const admin = await Admin.create({ username, passwordHash });
            return { message: "Admin created", adminId: admin._id };
        } catch (err) {
            return reply.code(400).send({ message: "User exists" });
        }
    });

    server.post('/login', async (request: any, reply) => {
        const { username, password } = request.body;
        const admin = await Admin.findOne({ username });

        const all_docs: IAdmin[] = await Admin.find({});
        console.log(all_docs)

        if (!admin || !(await bcrypt.compare(password, admin.passwordHash))) {
            return reply.code(401).send({ message: "Invalid credentials" });
        }

        const token = server.jwt.sign({ id: admin._id, username: admin.username });
        return { token };
    });
}
