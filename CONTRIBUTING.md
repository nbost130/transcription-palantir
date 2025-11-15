# 🤝 Contributing to Transcription Palantir

Thank you for your interest in contributing to the Transcription Palantir project! This document provides guidelines and information for contributors.

## 🚀 Getting Started

### Prerequisites
- **Bun** >= 1.0.0 (or Node.js >= 18.0.0)
- **Redis** >= 6.0.0
- **Git** for version control
- **Docker** (optional, for containerized development)

### Development Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/nbost130/transcription-palantir.git
   cd transcription-palantir
   ```

2. **Install dependencies**
   ```bash
   bun install
   ```

3. **Set up environment**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Run setup script**
   ```bash
   bun run scripts/setup-dev.ts
   ```

5. **Start development server**
   ```bash
   bun run dev
   ```

## 📋 Development Workflow

### Branch Strategy
- **main**: Production-ready code
- **develop**: Integration branch for features
- **feature/***: Individual feature branches
- **hotfix/***: Critical bug fixes

### Commit Convention
We use conventional commits for clear history:

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

**Examples:**
```
feat(api): add job management endpoints
fix(queue): resolve Redis connection timeout
docs(readme): update installation instructions
```

### Code Quality Standards

#### TypeScript
- Use strict TypeScript configuration
- Provide proper type annotations
- Avoid `any` types when possible
- Use interfaces for object shapes

#### Code Style
- Run `bun run lint` before committing
- Run `bun run format` to format code
- Follow existing code patterns
- Add JSDoc comments for public APIs

#### Testing
- Write tests for new features
- Maintain test coverage above 80%
- Use descriptive test names
- Test both success and error cases

## 🧪 Testing

### Running Tests
```bash
# Run all tests
bun test

# Run tests in watch mode
bun test --watch

# Run tests with coverage
bun test --coverage
```

### Test Structure
- **Unit tests**: Test individual functions/classes
- **Integration tests**: Test service interactions
- **E2E tests**: Test complete workflows

## 📝 Pull Request Process

1. **Create a feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes**
   - Follow coding standards
   - Add tests for new functionality
   - Update documentation as needed

3. **Test your changes**
   ```bash
   bun run build
   bun test
   bun run lint
   ```

4. **Commit your changes**
   ```bash
   git add .
   git commit -m "feat: add your feature description"
   ```

5. **Push and create PR**
   ```bash
   git push origin feature/your-feature-name
   ```

### PR Requirements
- [ ] All tests pass
- [ ] Code follows style guidelines
- [ ] Documentation updated
- [ ] No merge conflicts
- [ ] Descriptive PR title and description

## 🐛 Bug Reports

When reporting bugs, please include:
- **Environment**: OS, Bun/Node version, Redis version
- **Steps to reproduce**: Clear, numbered steps
- **Expected behavior**: What should happen
- **Actual behavior**: What actually happens
- **Logs**: Relevant error messages or logs
- **Screenshots**: If applicable

## 💡 Feature Requests

For feature requests, please provide:
- **Problem description**: What problem does this solve?
- **Proposed solution**: How should it work?
- **Alternatives considered**: Other approaches you've thought of
- **Use cases**: When would this be useful?

## 📚 Documentation

- Update README.md for user-facing changes
- Update TODO.md for project planning changes
- Add JSDoc comments for new APIs
- Update type definitions as needed

## 🏗️ Architecture Guidelines

### Service Design
- Keep services focused and cohesive
- Use dependency injection for testability
- Implement proper error handling
- Add comprehensive logging

### API Design
- Follow RESTful conventions
- Use proper HTTP status codes
- Validate input with Zod schemas
- Document with OpenAPI/Swagger

### Database Design
- Use Redis for queue state
- Consider data consistency
- Implement proper indexing
- Add migration scripts

## 🤔 Questions?

- Check existing issues and discussions
- Review the TODO.md for project status
- Ask questions in GitHub Discussions
- Contact maintainers for urgent matters

## 📄 License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

**Thank you for contributing to Transcription Palantir! 🔮**
