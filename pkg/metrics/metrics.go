package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	// RequestDuration tracks request duration in seconds
	RequestDuration = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "grpc_request_duration_seconds",
			Help:    "Duration of gRPC requests in seconds",
			Buckets: prometheus.DefBuckets,
		},
		[]string{"service", "method", "status"},
	)

	// RequestsTotal tracks total number of requests
	RequestsTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "grpc_requests_total",
			Help: "Total number of gRPC requests",
		},
		[]string{"service", "method", "status"},
	)

	// ActiveConnections tracks currently active connections
	ActiveConnections = promauto.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "grpc_active_connections",
			Help: "Number of active gRPC connections",
		},
		[]string{"service"},
	)

	// DatabaseQueries tracks database query duration
	DatabaseQueries = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "database_query_duration_seconds",
			Help:    "Duration of database queries in seconds",
			Buckets: prometheus.DefBuckets,
		},
		[]string{"operation", "table"},
	)

	// CacheHits tracks cache hit/miss ratio
	CacheHits = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "cache_requests_total",
			Help: "Total number of cache requests",
		},
		[]string{"operation", "status"},
	)

	// NotificationsSent tracks sent notifications
	NotificationsSent = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "notifications_sent_total",
			Help: "Total number of notifications sent",
		},
		[]string{"type", "status"},
	)

	// ActiveSubscribers tracks active notification subscribers
	ActiveSubscribers = promauto.NewGauge(
		prometheus.GaugeOpts{
			Name: "notification_active_subscribers",
			Help: "Number of active notification subscribers",
		},
	)
)
