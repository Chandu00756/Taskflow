package cache

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// // // RedisClient wraps the Redis client
type RedisClient struct {
	client *redis.Client
}

// // // NewRedisClient creates a new Redis client
func NewRedisClient(addr, password string, db int) (*RedisClient, error) {
	client := redis.NewClient(&redis.Options{
		Addr:     addr,
		Password: password,
		DB:       db,
	})

	// 	// 	// Test connection
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := client.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("failed to connect to Redis: %w", err)
	}

	return &RedisClient{client: client}, nil
}

// // // Set stores a key-value pair with expiration
func (r *RedisClient) Set(ctx context.Context, key string, value interface{}, expiration time.Duration) error {
	return r.client.Set(ctx, key, value, expiration).Err()
}

// // // Get retrieves a value by key
func (r *RedisClient) Get(ctx context.Context, key string) (string, error) {
	return r.client.Get(ctx, key).Result()
}

// // // Delete removes a key
func (r *RedisClient) Delete(ctx context.Context, keys ...string) error {
	return r.client.Del(ctx, keys...).Err()
}

// // // Exists checks if a key exists
func (r *RedisClient) Exists(ctx context.Context, keys ...string) (int64, error) {
	return r.client.Exists(ctx, keys...).Result()
}

// // // Close closes the Redis connection
func (r *RedisClient) Close() error {
	return r.client.Close()
}

// Publish publishes a message to a Redis channel
func (r *RedisClient) Publish(ctx context.Context, channel string, message interface{}) error {
	return r.client.Publish(ctx, channel, message).Err()
}

// Subscribe subscribes to the given channels and returns a PubSub
func (r *RedisClient) Subscribe(ctx context.Context, channels ...string) *redis.PubSub {
	return r.client.Subscribe(ctx, channels...)
}

// PSubscribe subscribes to channels matching the given pattern and returns a PubSub
func (r *RedisClient) PSubscribe(ctx context.Context, pattern string) *redis.PubSub {
	return r.client.PSubscribe(ctx, pattern)
}

// XAdd appends an entry to a Redis stream and returns the entry ID
func (r *RedisClient) XAdd(ctx context.Context, stream string, values map[string]interface{}) (string, error) {
	args := &redis.XAddArgs{
		Stream: stream,
		Values: values,
	}
	return r.client.XAdd(ctx, args).Result()
}

// XGroupCreateMkStream creates a consumer group for a stream (creates stream if missing)
func (r *RedisClient) XGroupCreateMkStream(ctx context.Context, stream, group, start string) error {
	return r.client.XGroupCreateMkStream(ctx, stream, group, start).Err()
}

// XReadGroup reads entries for a consumer group
func (r *RedisClient) XReadGroup(ctx context.Context, group, consumer, stream string, count int64, block time.Duration) ([]redis.XMessage, error) {
	res, err := r.client.XReadGroup(ctx, &redis.XReadGroupArgs{
		Group:    group,
		Consumer: consumer,
		Streams:  []string{stream, ">"},
		Count:    count,
		Block:    block,
	}).Result()
	if err != nil {
		return nil, err
	}
	if len(res) == 0 {
		return nil, nil
	}
	return res[0].Messages, nil
}

// XAck acknowledges a message in a stream consumer group
func (r *RedisClient) XAck(ctx context.Context, stream, group string, ids ...string) (int64, error) {
	return r.client.XAck(ctx, stream, group, ids...).Result()
}

// XPendingRange retrieves pending messages for the group
func (r *RedisClient) XPendingRange(ctx context.Context, stream, group string, start, end string, count int64) ([]redis.XPendingExt, error) {
	return r.client.XPendingExt(ctx, &redis.XPendingExtArgs{
		Stream: stream,
		Group:  group,
		Start:  start,
		End:    end,
		Count:  count,
	}).Result()
}
