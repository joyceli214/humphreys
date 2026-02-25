.PHONY: up down api web test-api test-web gen-types

up:
	docker compose up -d db

down:
	docker compose down

api:
	cd api && go run ./cmd/server

web:
	cd web && npm install && npm run dev

test-api:
	cd api && go test ./...

test-web:
	cd web && npm install && npm run test

gen-types:
	cd web && npm install && npm run generate:api
