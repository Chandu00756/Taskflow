package auth

import (
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

var (
	ErrInvalidToken = errors.New("invalid token")
	ErrExpiredToken = errors.New("token has expired")
)

// // // JWTManager manages JWT tokens
type JWTManager struct {
	secretKey            string
	accessTokenDuration  time.Duration
	refreshTokenDuration time.Duration
}

// // // Claims represents JWT claims
type Claims struct {
	UserID string `json:"user_id"`
	Email  string `json:"email"`
	Role   string `json:"role"`
	OrgID  string `json:"org_id"`
	jwt.RegisteredClaims
}

// // // NewJWTManager creates a new JWT manager
func NewJWTManager(secretKey string, accessTokenDuration, refreshTokenDuration time.Duration) *JWTManager {
	return &JWTManager{
		secretKey:            secretKey,
		accessTokenDuration:  accessTokenDuration,
		refreshTokenDuration: refreshTokenDuration,
	}
}

// // // GenerateAccessToken generates a new access token
func (m *JWTManager) GenerateAccessToken(userID, email, role, orgID string) (string, error) {
	claims := &Claims{
		UserID: userID,
		Email:  email,
		Role:   role,
		OrgID:  orgID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(m.accessTokenDuration)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			NotBefore: jwt.NewNumericDate(time.Now()),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(m.secretKey))
}

// // // GenerateRefreshToken generates a new refresh token
func (m *JWTManager) GenerateRefreshToken(userID string) (string, error) {
	claims := &Claims{
		UserID: userID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(m.refreshTokenDuration)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			NotBefore: jwt.NewNumericDate(time.Now()),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(m.secretKey))
}

// // // ValidateToken validates a JWT token and returns the claims
func (m *JWTManager) ValidateToken(tokenString string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, ErrInvalidToken
		}
		return []byte(m.secretKey), nil
	})

	if err != nil {
		return nil, err
	}

	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, ErrInvalidToken
	}

	if time.Now().After(claims.ExpiresAt.Time) {
		return nil, ErrExpiredToken
	}

	return claims, nil
}

// // // Verify is an alias for ValidateToken for backward compatibility
func (m *JWTManager) Verify(tokenString string) (*Claims, error) {
	return m.ValidateToken(tokenString)
}
