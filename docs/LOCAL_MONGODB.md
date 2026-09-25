# Local MongoDB replica set (optional)

Atlas supports the transactions used by this API. If you prefer local MongoDB with Docker Desktop:

```
docker compose up -d
docker compose exec mongo mongosh --eval "rs.initiate({_id:'rs0',members:[{_id:0,host:'localhost:27017'}]})"
```

Use `mongodb://127.0.0.1:27017/school_platform_v2?replicaSet=rs0&directConnection=true` in `.env`. Wait for the primary to be elected before starting API. The Docker configuration binds MongoDB to localhost only. It is a development configuration, not a production database deployment.
