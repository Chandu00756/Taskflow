package service

import (
	"context"
	"errors"
	"strings"

	"github.com/chanduchitikam/task-management-system/pkg/cache"
	taskpb "github.com/chanduchitikam/task-management-system/proto/task"
	"github.com/chanduchitikam/task-management-system/services/task/models"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
)

// TaskService implements the TaskService gRPC service
type TaskService struct {
	taskpb.UnimplementedTaskServiceServer
	db    *gorm.DB
	cache *cache.RedisClient
}

// NewTaskService creates a new TaskService instance
func NewTaskService(db *gorm.DB, cache *cache.RedisClient) *TaskService {
	return &TaskService{
		db:    db,
		cache: cache,
	}
}

// CreateTask creates a new task
func (s *TaskService) CreateTask(ctx context.Context, req *taskpb.CreateTaskRequest) (*taskpb.CreateTaskResponse, error) {
	if req.Title == "" {
		return nil, status.Error(codes.InvalidArgument, "title is required")
	}

	// TODO: Get created_by from JWT context
	// For now, use a dummy UUID since "system" is not a valid UUID
	createdBy := "00000000-0000-0000-0000-000000000000" // System user placeholder

	// Respect the requested status, default to "todo" if not specified
	taskStatus := "todo"
	if req.Status != taskpb.TaskStatus_TASK_STATUS_UNSPECIFIED {
		taskStatus = s.statusToString(req.Status)
	}

	// Respect the requested priority, default to "medium" if not specified
	taskPriority := "medium"
	if req.Priority != taskpb.TaskPriority_TASK_PRIORITY_UNSPECIFIED {
		taskPriority = s.priorityToString(req.Priority)
	}

	task := &models.Task{
		Title:       req.Title,
		Description: req.Description,
		Priority:    taskPriority,
		CreatedBy:   createdBy,
		Status:      taskStatus,
		Tags:        strings.Join(req.Tags, ","),
	}

	// Only set AssignedTo if it's not empty (to avoid UUID constraint violation)
	if req.AssignedTo != "" {
		task.AssignedTo = &req.AssignedTo
	}

	// Only set TeamID if it's not empty
	if req.TeamId != "" {
		task.TeamID = &req.TeamId
	}

	if req.DueDate != nil {
		dueDate := req.DueDate.AsTime()
		task.DueDate = &dueDate
	}

	if err := s.db.Create(task).Error; err != nil {
		return nil, status.Error(codes.Internal, "failed to create task")
	}

	return &taskpb.CreateTaskResponse{
		Task:    s.modelToProto(task),
		Message: "Task created successfully",
	}, nil
}

// GetTask retrieves a task by ID
func (s *TaskService) GetTask(ctx context.Context, req *taskpb.GetTaskRequest) (*taskpb.GetTaskResponse, error) {
	if req.TaskId == "" {
		return nil, status.Error(codes.InvalidArgument, "task_id is required")
	}

	var task models.Task
	if err := s.db.Where("id = ?", req.TaskId).First(&task).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, status.Error(codes.NotFound, "task not found")
		}
		return nil, status.Error(codes.Internal, "failed to get task")
	}

	return &taskpb.GetTaskResponse{
		Task: s.modelToProto(&task),
	}, nil
}

// UpdateTask updates task information
func (s *TaskService) UpdateTask(ctx context.Context, req *taskpb.UpdateTaskRequest) (*taskpb.UpdateTaskResponse, error) {
	if req.TaskId == "" {
		return nil, status.Error(codes.InvalidArgument, "task_id is required")
	}

	var task models.Task
	if err := s.db.Where("id = ?", req.TaskId).First(&task).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, status.Error(codes.NotFound, "task not found")
		}
		return nil, status.Error(codes.Internal, "failed to find task")
	}

	// Update fields
	if req.Title != "" {
		task.Title = req.Title
	}
	if req.Description != "" {
		task.Description = req.Description
	}
	if req.Status != taskpb.TaskStatus_TASK_STATUS_UNSPECIFIED {
		task.Status = s.statusToString(req.Status)
	}
	if req.Priority != taskpb.TaskPriority_TASK_PRIORITY_UNSPECIFIED {
		task.Priority = s.priorityToString(req.Priority)
	}
	if req.AssignedTo != "" {
		task.AssignedTo = &req.AssignedTo
	}
	if req.DueDate != nil {
		dueDate := req.DueDate.AsTime()
		task.DueDate = &dueDate
	}
	if len(req.Tags) > 0 {
		task.Tags = strings.Join(req.Tags, ",")
	}

	if err := s.db.Save(&task).Error; err != nil {
		return nil, status.Error(codes.Internal, "failed to update task")
	}

	return &taskpb.UpdateTaskResponse{
		Task:    s.modelToProto(&task),
		Message: "Task updated successfully",
	}, nil
}

// DeleteTask deletes a task
func (s *TaskService) DeleteTask(ctx context.Context, req *taskpb.DeleteTaskRequest) (*taskpb.DeleteTaskResponse, error) {
	if req.TaskId == "" {
		return nil, status.Error(codes.InvalidArgument, "task_id is required")
	}

	result := s.db.Where("id = ?", req.TaskId).Delete(&models.Task{})
	if result.Error != nil {
		return nil, status.Error(codes.Internal, "failed to delete task")
	}

	if result.RowsAffected == 0 {
		return nil, status.Error(codes.NotFound, "task not found")
	}

	return &taskpb.DeleteTaskResponse{
		Message: "Task deleted successfully",
	}, nil
}

// ListTasks lists tasks with filters and pagination
func (s *TaskService) ListTasks(ctx context.Context, req *taskpb.ListTasksRequest) (*taskpb.ListTasksResponse, error) {
	page := req.Page
	if page < 1 {
		page = 1
	}

	pageSize := req.PageSize
	if pageSize < 1 {
		pageSize = 10
	}

	offset := (page - 1) * pageSize

	query := s.db.Model(&models.Task{})

	// Apply filters
	if req.StatusFilter != taskpb.TaskStatus_TASK_STATUS_UNSPECIFIED {
		query = query.Where("status = ?", s.statusToString(req.StatusFilter))
	}
	if req.PriorityFilter != taskpb.TaskPriority_TASK_PRIORITY_UNSPECIFIED {
		query = query.Where("priority = ?", s.priorityToString(req.PriorityFilter))
	}
	if req.TeamFilter != "" {
		query = query.Where("team_id = ?", req.TeamFilter)
	}
	if req.AssignedToFilter != "" {
		query = query.Where("assigned_to = ?", req.AssignedToFilter)
	}

	// Get total count
	var totalCount int64
	if err := query.Count(&totalCount).Error; err != nil {
		return nil, status.Error(codes.Internal, "failed to count tasks")
	}

	// Get tasks
	var tasks []models.Task
	if err := query.Offset(int(offset)).Limit(int(pageSize)).Order("created_at DESC").Find(&tasks).Error; err != nil {
		return nil, status.Error(codes.Internal, "failed to list tasks")
	}

	// Convert to proto
	protoTasks := make([]*taskpb.Task, len(tasks))
	for i, task := range tasks {
		protoTasks[i] = s.modelToProto(&task)
	}

	return &taskpb.ListTasksResponse{
		Tasks:      protoTasks,
		TotalCount: int32(totalCount),
		Page:       page,
		PageSize:   pageSize,
	}, nil
}

// AssignTask assigns a task to a user
func (s *TaskService) AssignTask(ctx context.Context, req *taskpb.AssignTaskRequest) (*taskpb.AssignTaskResponse, error) {
	if req.TaskId == "" || req.UserId == "" {
		return nil, status.Error(codes.InvalidArgument, "task_id and user_id are required")
	}

	var task models.Task
	if err := s.db.Where("id = ?", req.TaskId).First(&task).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, status.Error(codes.NotFound, "task not found")
		}
		return nil, status.Error(codes.Internal, "failed to find task")
	}

	task.AssignedTo = &req.UserId

	if err := s.db.Save(&task).Error; err != nil {
		return nil, status.Error(codes.Internal, "failed to assign task")
	}

	// TODO: Send notification to assigned user

	return &taskpb.AssignTaskResponse{
		Task:    s.modelToProto(&task),
		Message: "Task assigned successfully",
	}, nil
}

// UpdateTaskStatus updates task status
func (s *TaskService) UpdateTaskStatus(ctx context.Context, req *taskpb.UpdateTaskStatusRequest) (*taskpb.UpdateTaskStatusResponse, error) {
	if req.TaskId == "" {
		return nil, status.Error(codes.InvalidArgument, "task_id is required")
	}

	var task models.Task
	if err := s.db.Where("id = ?", req.TaskId).First(&task).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, status.Error(codes.NotFound, "task not found")
		}
		return nil, status.Error(codes.Internal, "failed to find task")
	}

	task.Status = s.statusToString(req.Status)

	if err := s.db.Save(&task).Error; err != nil {
		return nil, status.Error(codes.Internal, "failed to update task status")
	}

	// TODO: Send notification for status change

	return &taskpb.UpdateTaskStatusResponse{
		Task:    s.modelToProto(&task),
		Message: "Task status updated successfully",
	}, nil
}

// GetUserTasks gets tasks assigned to a user
func (s *TaskService) GetUserTasks(ctx context.Context, req *taskpb.GetUserTasksRequest) (*taskpb.GetUserTasksResponse, error) {
	if req.UserId == "" {
		return nil, status.Error(codes.InvalidArgument, "user_id is required")
	}

	page := req.Page
	if page < 1 {
		page = 1
	}

	pageSize := req.PageSize
	if pageSize < 1 {
		pageSize = 10
	}

	offset := (page - 1) * pageSize

	query := s.db.Model(&models.Task{}).Where("assigned_to = ?", req.UserId)

	if req.StatusFilter != taskpb.TaskStatus_TASK_STATUS_UNSPECIFIED {
		query = query.Where("status = ?", s.statusToString(req.StatusFilter))
	}

	var totalCount int64
	if err := query.Count(&totalCount).Error; err != nil {
		return nil, status.Error(codes.Internal, "failed to count tasks")
	}

	var tasks []models.Task
	if err := query.Offset(int(offset)).Limit(int(pageSize)).Order("created_at DESC").Find(&tasks).Error; err != nil {
		return nil, status.Error(codes.Internal, "failed to get user tasks")
	}

	protoTasks := make([]*taskpb.Task, len(tasks))
	for i, task := range tasks {
		protoTasks[i] = s.modelToProto(&task)
	}

	return &taskpb.GetUserTasksResponse{
		Tasks:      protoTasks,
		TotalCount: int32(totalCount),
	}, nil
}

// Helper functions
func (s *TaskService) modelToProto(task *models.Task) *taskpb.Task {
	protoTask := &taskpb.Task{
		TaskId:      task.ID,
		Title:       task.Title,
		Description: task.Description,
		Status:      s.stringToStatus(task.Status),
		Priority:    s.stringToPriority(task.Priority),
		CreatedBy:   task.CreatedBy,
		CreatedAt:   timestamppb.New(task.CreatedAt),
		UpdatedAt:   timestamppb.New(task.UpdatedAt),
	}

	// Handle pointer fields
	if task.AssignedTo != nil {
		protoTask.AssignedTo = *task.AssignedTo
	}

	if task.TeamID != nil {
		protoTask.TeamId = *task.TeamID
	}

	if task.DueDate != nil {
		protoTask.DueDate = timestamppb.New(*task.DueDate)
	}

	if task.Tags != "" {
		protoTask.Tags = strings.Split(task.Tags, ",")
	}

	return protoTask
}

func (s *TaskService) statusToString(status taskpb.TaskStatus) string {
	switch status {
	case taskpb.TaskStatus_TASK_STATUS_TODO:
		return "todo"
	case taskpb.TaskStatus_TASK_STATUS_IN_PROGRESS:
		return "in_progress"
	case taskpb.TaskStatus_TASK_STATUS_IN_REVIEW:
		return "in_review"
	case taskpb.TaskStatus_TASK_STATUS_COMPLETED:
		return "completed"
	case taskpb.TaskStatus_TASK_STATUS_CANCELLED:
		return "cancelled"
	default:
		return "todo"
	}
}

func (s *TaskService) stringToStatus(status string) taskpb.TaskStatus {
	switch status {
	case "todo":
		return taskpb.TaskStatus_TASK_STATUS_TODO
	case "in_progress":
		return taskpb.TaskStatus_TASK_STATUS_IN_PROGRESS
	case "in_review":
		return taskpb.TaskStatus_TASK_STATUS_IN_REVIEW
	case "completed":
		return taskpb.TaskStatus_TASK_STATUS_COMPLETED
	case "cancelled":
		return taskpb.TaskStatus_TASK_STATUS_CANCELLED
	default:
		return taskpb.TaskStatus_TASK_STATUS_TODO
	}
}

func (s *TaskService) priorityToString(priority taskpb.TaskPriority) string {
	switch priority {
	case taskpb.TaskPriority_TASK_PRIORITY_LOW:
		return "low"
	case taskpb.TaskPriority_TASK_PRIORITY_MEDIUM:
		return "medium"
	case taskpb.TaskPriority_TASK_PRIORITY_HIGH:
		return "high"
	case taskpb.TaskPriority_TASK_PRIORITY_CRITICAL:
		return "critical"
	default:
		return "medium"
	}
}

func (s *TaskService) stringToPriority(priority string) taskpb.TaskPriority {
	switch priority {
	case "low":
		return taskpb.TaskPriority_TASK_PRIORITY_LOW
	case "medium":
		return taskpb.TaskPriority_TASK_PRIORITY_MEDIUM
	case "high":
		return taskpb.TaskPriority_TASK_PRIORITY_HIGH
	case "critical":
		return taskpb.TaskPriority_TASK_PRIORITY_CRITICAL
	default:
		return taskpb.TaskPriority_TASK_PRIORITY_MEDIUM
	}
}
