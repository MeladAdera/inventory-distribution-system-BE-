# Inventory Management Backend

A NestJS-based backend API for inventory management with JWT authentication, PostgreSQL database integration, and comprehensive development tooling.

## Tech Stack

- **Runtime**: Node.js
- **Framework**: NestJS 10
- **Language**: TypeScript 5.3
- **Database**: PostgreSQL with TypeORM
- **Authentication**: JWT with Passport
- **Testing**: Jest
- **Linting**: ESLint + Prettier
- **Git Hooks**: Husky + lint-staged

## Prerequisites

- Node.js 18+ (check: `node --version`)
- npm 9+ (check: `npm --version`)
- PostgreSQL 12+ (for database)

## Installation

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.development
# Edit .env.development with your local configuration
```

## Environment Setup

The project uses environment-specific configuration files:

- `.env.example` - Template with all required variables
- `.env.development` - Development environment
- `.env.test` - Test environment
- `.env.production` - Production environment (uses env vars)

Key environment variables:

```
NODE_ENV=development
PORT=3000
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_USERNAME=postgres
DATABASE_PASSWORD=postgres
DATABASE_NAME=inventory_db_dev
JWT_SECRET=your-secret-key
JWT_EXPIRATION=86400
LOG_LEVEL=debug
```

## Available Scripts

### Development

```bash
# Start development server with hot-reload
npm run start:dev

# Start production server
npm run start:prod

# Build the project
npm run build
```

### Testing

```bash
# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:cov

# Debug tests
npm run test:debug
```

### Code Quality

```bash
# Lint and fix code
npm run lint

# Format code with Prettier
npm run format
```

## Project Structure

```
src/
├── config/             # Configuration modules
│   └── database.config.ts
├── entities/           # TypeORM entities (create as needed)
├── migrations/         # Database migrations (create as needed)
├── app.controller.ts   # Main app controller
├── app.service.ts      # Main app service
├── app.module.ts       # Root module
└── main.ts             # Application entry point

dist/                   # Compiled JavaScript output
coverage/               # Test coverage reports
node_modules/           # Dependencies
```

## Database Setup

### PostgreSQL Installation

**Linux (Ubuntu/Debian):**
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
```

**macOS:**
```bash
brew install postgresql
brew services start postgresql
```

**Windows:**
Download and install from [postgresql.org](https://www.postgresql.org/download/windows/)

### Database Creation

```bash
# Create development database
createdb inventory_db_dev

# Create test database
createdb inventory_db_test

# Verify databases
psql -l
```

## Git Hooks

This project uses Husky and lint-staged for automated code quality checks:

- **Pre-commit**: Automatically lints and formats staged files
- Ensure your code passes ESLint and Prettier before committing

## Development Workflow

1. **Create a feature branch**
   ```bash
   git checkout -b feature/my-feature
   ```

2. **Make your changes and ensure code quality**
   ```bash
   npm run lint    # Fix linting issues
   npm run format  # Format code
   npm test        # Run tests
   ```

3. **Commit your changes**
   ```bash
   git commit -m "feat: add my feature"
   # Husky will automatically run linting and formatting
   ```

4. **Push and create a pull request**
   ```bash
   git push origin feature/my-feature
   ```

## API Endpoints

### Health Check

```
GET /
Response: { "message": "Welcome to Inventory Management Backend" }

GET /health
Response: { "status": "ok" }
```

## Creating New Features

### Generate a New Module

```bash
# Create a new feature module
npm run build -- --watch

# Using NestJS CLI (if installed globally)
nest generate module features/users
nest generate controller features/users
nest generate service features/users
```

### Example Entity Creation

Create `src/entities/user.entity.ts`:
```typescript
import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  username: string;

  @Column({ unique: true })
  email: string;

  @Column()
  password: string;
}
```

## Troubleshooting

### Database Connection Error
```
Error: connect ECONNREFUSED 127.0.0.1:5432
```
**Solution**: Ensure PostgreSQL is running and credentials in `.env.development` are correct.

### Port Already in Use
```
Error: listen EADDRINUSE :::3000
```
**Solution**: Change `PORT` in `.env.development` or kill the process using the port.

### ESLint Errors
```bash
# Fix automatically
npm run lint

# Check ESLint config
cat .eslintrc.js
```

### Tests Failing
```bash
# Run tests with verbose output
npm test -- --verbose

# Check test configuration
cat jest.config.js
```

## Code Standards

- **TypeScript**: Strict mode enabled
- **Naming**: camelCase for variables/functions, PascalCase for classes
- **Line Length**: Max 80 characters (configured in Prettier)
- **Imports**: Organized and grouped
- **Comments**: Only when necessary (explain "why", not "what")

## Performance Optimization

- Enable query logging only in development
- Use database indexes on frequently queried columns
- Implement pagination for list endpoints
- Consider caching for frequently accessed data

## Security

- Never commit `.env` files
- Always use HTTPS in production
- Keep dependencies updated: `npm audit fix`
- Validate all user input with class-validator
- Use strong JWT secrets in production

## Contributing

1. Follow the project code standards
2. Write tests for new features
3. Ensure all tests pass: `npm test`
4. Run linting before committing: `npm run lint`
5. Create descriptive commit messages

## License

MIT

## Support

For issues and questions, please check the [NestJS documentation](https://docs.nestjs.com/)

---

**Last Updated**: June 2, 2026
