# # # Contributing to Task Management System

Thank you for your interest in contributing to the Task Management System! This document provides guidelines and instructions for contributing.

# # ## 🤝 Code of Conduct

By participating in this project, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

# # ## 🚀 Getting Started

# # ### Prerequisites

Before you begin, ensure you have the following installed:

- Go 1.21 or higher
- Node.js 18+ and npm
- PostgreSQL 14+
- Redis 6+
- Protocol Buffers compiler (`protoc`)
- Git

# # ### Setting Up Your Development Environment

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:

   ```bash
   git clone https://github.com/YOUR_USERNAME/task-management-system.git
   cd task-management-system
   ```

3. **Add upstream remote**:

   ```bash
   git remote add upstream https://github.com/ORIGINAL_OWNER/task-management-system.git
   ```

4. **Install dependencies**:

   ```bash
   go mod download
   cd frontend && npm install && cd ..
   ```

5. **Set up database**:

   ```bash
   createdb taskmanagement
   psql taskmanagement < scripts/schema.sql
   ```

6. **Configure environment**:

   ```bash
   cp .env.example .env
# # # Edit .env with your local settings
   ```

7. **Generate Protocol Buffers**:

   ```bash
   ./scripts/generate-proto.sh
   ```

8. **Start services**:

   ```bash
   ./start.sh
   ```

# # ## 📝 Development Workflow

# # ### 1. Create a Branch

Always create a new branch for your work:

```bash
git checkout -b feature/your-feature-name
# # # or
git checkout -b fix/bug-description
```

Branch naming conventions:

- `feature/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation changes
- `refactor/` - Code refactoring
- `test/` - Adding or updating tests
- `chore/` - Maintenance tasks

# # ### 2. Make Your Changes

- Write clean, readable code
- Follow the existing code style
- Add tests for new features
- Update documentation as needed
- Keep commits atomic and focused

# # ### 3. Test Your Changes

# # #### Backend Tests

```bash
# # # Run all tests
make test

# # # Run specific service tests
cd services/task && go test -v ./...

# # # Run with coverage
make test-coverage
```

# # #### Frontend Tests

```bash
cd frontend
npm test
npm run lint
```

# # #### Integration Tests

```bash
./scripts/load-test.sh
```

# # ### 4. Commit Your Changes

Write clear, descriptive commit messages:

```bash
git add .
git commit -m "feat: add task filtering by tags

- Implement tag filtering in task service
- Add UI components for tag selection
- Update API documentation"
```

**Commit message format:**

```
<type>: <subject>

<body>

<footer>
```

**Types:**

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

# # ### 5. Push to Your Fork

```bash
git push origin feature/your-feature-name
```

# # ### 6. Create a Pull Request

1. Go to your fork on GitHub
2. Click "New Pull Request"
3. Select your branch
4. Fill out the PR template with:
   - Description of changes
   - Related issue number (if applicable)
   - Screenshots (for UI changes)
   - Testing performed

# # ## 🎯 Contribution Guidelines

# # ### Code Style

# # #### Go Code

- Follow [Effective Go](https://golang.org/doc/effective_go.html)
- Use `gofmt` for formatting
- Run `golint` and address warnings
- Keep functions focused and small
- Write meaningful variable names
- Add comments for exported functions

```go
// Good
func CreateTask(ctx context.Context, req *CreateTaskRequest) (*Task, error) {
    // Validate request
    if err := validateTaskRequest(req); err != nil {
        return nil, err
    }
    
    // Create task
    task := &Task{
        Title:       req.Title,
        Description: req.Description,
    }
    
    return task, nil
}

// Bad
func ct(c context.Context, r *CreateTaskRequest) (*Task, error) {
    t := &Task{r.Title, r.Description}
    return t, nil
}
```

# # #### TypeScript/React Code

- Follow the existing ESLint configuration
- Use TypeScript for type safety
- Prefer functional components with hooks
- Use meaningful component and variable names
- Extract reusable logic into custom hooks

```typescript
// Good
const TaskList: React.FC<TaskListProps> = ({ tasks, onTaskClick }) => {
  const [filter, setFilter] = useState<TaskFilter>('all');
  
  const filteredTasks = useMemo(() => {
    return filterTasks(tasks, filter);
  }, [tasks, filter]);
  
  return (
    <div className="task-list">
      {filteredTasks.map(task => (
        <TaskCard key={task.id} task={task} onClick={onTaskClick} />
      ))}
    </div>
  );
};

// Bad
const TL = ({ t, o }) => {
  const [f, sf] = useState('all');
  return <div>{t.map(x => <div onClick={() => o(x)}>{x.title}</div>)}</div>;
};
```

# # ### Testing Guidelines

- Write tests for all new features
- Maintain or improve code coverage
- Include unit, integration, and e2e tests where appropriate
- Mock external dependencies
- Use table-driven tests in Go

**Go Test Example:**

```go
func TestCreateTask(t *testing.T) {
    tests := []struct {
        name    string
        input   *CreateTaskRequest
        want    *Task
        wantErr bool
    }{
        {
            name: "valid task",
            input: &CreateTaskRequest{
                Title:       "Test Task",
                Description: "Test Description",
            },
            want: &Task{
                Title:       "Test Task",
                Description: "Test Description",
            },
            wantErr: false,
        },
        // More test cases...
    }
    
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            got, err := CreateTask(context.Background(), tt.input)
            if (err != nil) != tt.wantErr {
                t.Errorf("CreateTask() error = %v, wantErr %v", err, tt.wantErr)
                return
            }
            if !reflect.DeepEqual(got, tt.want) {
                t.Errorf("CreateTask() = %v, want %v", got, tt.want)
            }
        })
    }
}
```

# # ### Documentation

- Update documentation for any API changes
- Add JSDoc/GoDoc comments for new functions
- Update README.md if needed
- Include examples in documentation
- Keep diagrams and architecture docs up to date

# # ### Protocol Buffers

When modifying `.proto` files:

1. Update the proto definition
2. Run `./scripts/generate-proto.sh`
3. Update affected services
4. Update API documentation
5. Test all affected endpoints

# # ## 🐛 Reporting Bugs

# # ### Before Submitting a Bug Report

- Check existing issues to avoid duplicates
- Verify the bug exists in the latest version
- Gather relevant information (logs, screenshots, etc.)

# # ### Submitting a Bug Report

Include:

- **Clear title** describing the issue
- **Steps to reproduce** the bug
- **Expected behavior** vs actual behavior
- **Environment** (OS, Go version, Node version, etc.)
- **Logs/screenshots** if applicable
- **Possible solution** (if you have one)

# # ## 💡 Suggesting Enhancements

We welcome feature suggestions! Please:

- Check existing issues for similar requests
- Clearly describe the feature and its benefits
- Provide use cases and examples
- Consider implementation complexity
- Be open to discussion and feedback

# # ## 🔍 Pull Request Review Process

1. **Automated checks** must pass (tests, linting, build)
2. **Code review** by at least one maintainer
3. **Documentation** review if applicable
4. **Testing** verification
5. **Approval** and merge by maintainer

# # ### PR Checklist

Before submitting your PR, ensure:

- [ ] Code follows project style guidelines
- [ ] All tests pass
- [ ] New tests added for new features
- [ ] Documentation updated
- [ ] Commit messages are clear
- [ ] No merge conflicts
- [ ] PR description is complete
- [ ] Screenshots included (for UI changes)

# # ## 🏷️ Issue Labels

- `bug` - Something isn't working
- `enhancement` - New feature or request
- `documentation` - Documentation improvements
- `good first issue` - Good for newcomers
- `help wanted` - Extra attention needed
- `question` - Further information requested
- `wontfix` - This will not be worked on

# # ## 📞 Getting Help

- **Documentation**: Check [docs/](docs/)
- **Discussions**: Use GitHub Discussions for questions
- **Issues**: Search existing issues or create a new one
- **Discord**: Join our community (link if available)

# # ## 🙏 Recognition

Contributors will be:

- Listed in the project's contributor list
- Mentioned in release notes for significant contributions
- Recognized in the community

# # ## 📜 License

By contributing, you agree that your contributions will be licensed under the same [MIT License](LICENSE) that covers this project.

---

Thank you for contributing to Task Management System! 🎉
