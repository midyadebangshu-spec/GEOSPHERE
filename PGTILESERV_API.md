# PostGIS API with pg_tileserv

This setup provides a PostGIS API using pg_tileserv to serve vector tiles from a PostgreSQL database with PostGIS extension.

## Quick Start

### 1. Start the Services

```bash
docker-compose up -d
```

This will start:
- PostgreSQL with PostGIS extension on port 5432
- pg_tileserv on port 7800

### 2. Access Your Data

Once the services are running, your PostGIS data will be available as vector tiles at:

```
http://localhost:7800/public.{table_name}/{z}/{x}/{y}.pbf
```

For example, if you have a table called `world_map`:
```
http://localhost:7800/public.world_map/{z}/{x}/{y}.pbf
```

### 3. Browse Available Layers

To see all available layers and their metadata:
```
http://localhost:7800/
```

## Database Configuration

Default database connection:
- **Host**: localhost
- **Port**: 5432
- **Database**: geodb
- **Username**: geo_user
- **Password**: geo_pass

## Adding Sample Data

### Connect to the Database

```bash
docker exec -it postgis_db psql -U geo_user -d geodb
```

### Create a Sample Table

```sql
-- Create a sample world countries table
CREATE TABLE world_map (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100),
    geometry GEOMETRY(Polygon, 4326)
);

-- Insert sample data (simplified)
INSERT INTO world_map (name, geometry) VALUES 
('Sample Area', ST_GeomFromText('POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))', 4326));

-- Create spatial index for better performance
CREATE INDEX idx_world_map_geometry ON world_map USING GIST (geometry);
```

## API Usage Examples

### Get Layer Information
```bash
curl http://localhost:7800/public.world_map
```

### Get Specific Tile
```bash
curl http://localhost:7800/public.world_map/0/0/0.pbf
```

### Get Tile with Custom Parameters
```bash
curl "http://localhost:7800/public.world_map/10/512/384.pbf?limit=1000"
```

## Configuration

### Environment Variables

You can customize the database connection by modifying the `DATABASE_URL` environment variable in the `docker-compose.yml` file:

```yaml
environment:
  DATABASE_URL: postgresql://username:password@host:port/database
```

### pg_tileserv Configuration

For advanced configuration, you can mount a configuration file:

```yaml
volumes:
  - ./pg_tileserv.toml:/etc/pg_tileserv.toml
```

## Troubleshooting

### Check Service Status
```bash
docker-compose ps
```

### View Logs
```bash
docker-compose logs pg_tileserv
docker-compose logs postgres
```

### Restart Services
```bash
docker-compose restart
```

### Stop Services
```bash
docker-compose down
```

## Development

### Adding Custom SQL Functions

You can add custom SQL functions by placing `.sql` files in the `init-scripts/` directory. These will be executed when the database is first created.

### Performance Tips

1. Always create spatial indexes on geometry columns
2. Use appropriate SRID (Spatial Reference ID) for your data
3. Consider materialized views for complex queries
4. Monitor tile generation performance

## Resources

- [pg_tileserv Documentation](https://github.com/CrunchyData/pg_tileserv)
- [PostGIS Documentation](https://postgis.net/docs/)
- [Vector Tile Specification](https://github.com/mapbox/vector-tile-spec/)
