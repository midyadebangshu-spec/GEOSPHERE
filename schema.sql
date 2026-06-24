--
-- PostgreSQL database dump
--

\restrict NpjwpY8gd34RktcJzPhObaXnK6azdRS6D0Jm5WrlG6OXHjh9ZNw5oCyGdQgknlc

-- Dumped from database version 16.14 (Ubuntu 16.14-0ubuntu0.24.04.1)
-- Dumped by pg_dump version 16.14 (Ubuntu 16.14-0ubuntu0.24.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: hstore; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS hstore WITH SCHEMA public;


--
-- Name: EXTENSION hstore; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION hstore IS 'data type for storing sets of (key, value) pairs';


--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: postgis; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;


--
-- Name: EXTENSION postgis; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION postgis IS 'PostGIS geometry and geography spatial types and functions';


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: planet_osm_index_bucket(bigint[]); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.planet_osm_index_bucket(bigint[]) RETURNS bigint[]
    LANGUAGE sql IMMUTABLE
    AS $_$  SELECT ARRAY(SELECT DISTINCT    unnest($1) >> 5)$_$;


ALTER FUNCTION public.planet_osm_index_bucket(bigint[]) OWNER TO postgres;

--
-- Name: planet_osm_line_osm2pgsql_valid(); Type: FUNCTION; Schema: public; Owner: deb
--

CREATE FUNCTION public.planet_osm_line_osm2pgsql_valid() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF ST_IsValid(NEW.way) THEN 
    RETURN NEW;
  END IF;
  RETURN NULL;
END;$$;


ALTER FUNCTION public.planet_osm_line_osm2pgsql_valid() OWNER TO deb;

--
-- Name: planet_osm_member_ids(jsonb, character); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.planet_osm_member_ids(jsonb, character) RETURNS bigint[]
    LANGUAGE sql IMMUTABLE
    AS $_$  SELECT array_agg((el->>'ref')::int8)   FROM jsonb_array_elements($1) AS el    WHERE el->>'type' = $2$_$;


ALTER FUNCTION public.planet_osm_member_ids(jsonb, character) OWNER TO postgres;

--
-- Name: planet_osm_point_osm2pgsql_valid(); Type: FUNCTION; Schema: public; Owner: deb
--

CREATE FUNCTION public.planet_osm_point_osm2pgsql_valid() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF ST_IsValid(NEW.way) THEN 
    RETURN NEW;
  END IF;
  RETURN NULL;
END;$$;


ALTER FUNCTION public.planet_osm_point_osm2pgsql_valid() OWNER TO deb;

--
-- Name: planet_osm_polygon_osm2pgsql_valid(); Type: FUNCTION; Schema: public; Owner: deb
--

CREATE FUNCTION public.planet_osm_polygon_osm2pgsql_valid() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF ST_IsValid(NEW.way) THEN 
    RETURN NEW;
  END IF;
  RETURN NULL;
END;$$;


ALTER FUNCTION public.planet_osm_polygon_osm2pgsql_valid() OWNER TO deb;

--
-- Name: planet_osm_roads_osm2pgsql_valid(); Type: FUNCTION; Schema: public; Owner: deb
--

CREATE FUNCTION public.planet_osm_roads_osm2pgsql_valid() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF ST_IsValid(NEW.way) THEN 
    RETURN NEW;
  END IF;
  RETURN NULL;
END;$$;


ALTER FUNCTION public.planet_osm_roads_osm2pgsql_valid() OWNER TO deb;

--
-- Name: set_institutions_updated_at(); Type: FUNCTION; Schema: public; Owner: deb
--

CREATE FUNCTION public.set_institutions_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.set_institutions_updated_at() OWNER TO deb;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: analytics_cache; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.analytics_cache (
    id integer NOT NULL,
    region_name character varying(256),
    stat_type character varying(128),
    stat_value numeric,
    bbox public.geometry(Polygon,4326),
    computed_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.analytics_cache OWNER TO postgres;

--
-- Name: analytics_cache_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.analytics_cache_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.analytics_cache_id_seq OWNER TO postgres;

--
-- Name: analytics_cache_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.analytics_cache_id_seq OWNED BY public.analytics_cache.id;


--
-- Name: api_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.api_logs (
    id bigint NOT NULL,
    method character varying(10),
    path character varying(512),
    status_code integer,
    response_ms integer,
    ip character varying(45),
    user_id uuid,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.api_logs OWNER TO postgres;

--
-- Name: api_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.api_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.api_logs_id_seq OWNER TO postgres;

--
-- Name: api_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.api_logs_id_seq OWNED BY public.api_logs.id;


--
-- Name: favorites; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.favorites (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid,
    place_id integer,
    name character varying(256),
    lat double precision NOT NULL,
    lon double precision NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.favorites OWNER TO postgres;

--
-- Name: geofences; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.geofences (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid,
    name character varying(256) NOT NULL,
    description text,
    geom public.geometry(Polygon,4326) NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.geofences OWNER TO postgres;

--
-- Name: institutions; Type: TABLE; Schema: public; Owner: deb
--

CREATE TABLE public.institutions (
    id text NOT NULL,
    name text NOT NULL,
    type text NOT NULL,
    subtype text,
    lat double precision,
    lon double precision,
    geom public.geometry(Point,4326),
    address text,
    district text,
    source text NOT NULL,
    source_id text,
    udise_code text,
    aishe_id text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT institutions_type_check CHECK ((type = ANY (ARRAY['school'::text, 'college'::text, 'university'::text])))
);


ALTER TABLE public.institutions OWNER TO deb;

--
-- Name: mandirs; Type: TABLE; Schema: public; Owner: deb
--

CREATE TABLE public.mandirs (
    id integer NOT NULL,
    sem_id integer NOT NULL,
    sem_setm_id smallint,
    name text NOT NULL,
    account_code text,
    est_date date,
    address text,
    pincode character varying(10),
    district text,
    state text,
    country text DEFAULT 'INDIA'::text,
    image_url text,
    worker_details jsonb,
    geom public.geometry(Point,4326),
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.mandirs OWNER TO deb;

--
-- Name: mandirs_id_seq; Type: SEQUENCE; Schema: public; Owner: deb
--

CREATE SEQUENCE public.mandirs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.mandirs_id_seq OWNER TO deb;

--
-- Name: mandirs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: deb
--

ALTER SEQUENCE public.mandirs_id_seq OWNED BY public.mandirs.id;


--
-- Name: osm2pgsql_properties; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.osm2pgsql_properties (
    property text NOT NULL,
    value text NOT NULL
);


ALTER TABLE public.osm2pgsql_properties OWNER TO postgres;

--
-- Name: places; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.places (
    id integer NOT NULL,
    osm_id bigint,
    name character varying(512),
    type character varying(128),
    subtype character varying(128),
    address text,
    tags public.hstore,
    geom public.geometry(Point,4326) NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.places OWNER TO postgres;

--
-- Name: places_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.places_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.places_id_seq OWNER TO postgres;

--
-- Name: places_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.places_id_seq OWNED BY public.places.id;


--
-- Name: planet_osm_line; Type: TABLE; Schema: public; Owner: deb
--

CREATE TABLE public.planet_osm_line (
    osm_id bigint,
    access text,
    "addr:housename" text,
    "addr:housenumber" text,
    "addr:interpolation" text,
    admin_level text,
    aerialway text,
    aeroway text,
    amenity text,
    area text,
    barrier text,
    bicycle text,
    brand text,
    bridge text,
    boundary text,
    building text,
    construction text,
    covered text,
    culvert text,
    cutting text,
    denomination text,
    disused text,
    embankment text,
    foot text,
    "generator:source" text,
    harbour text,
    highway text,
    historic text,
    horse text,
    intermittent text,
    junction text,
    landuse text,
    layer text,
    leisure text,
    lock text,
    man_made text,
    military text,
    motorcar text,
    name text,
    "natural" text,
    office text,
    oneway text,
    operator text,
    place text,
    population text,
    power text,
    power_source text,
    public_transport text,
    railway text,
    ref text,
    religion text,
    route text,
    service text,
    shop text,
    sport text,
    surface text,
    toll text,
    tourism text,
    "tower:type" text,
    tracktype text,
    tunnel text,
    water text,
    waterway text,
    wetland text,
    width text,
    wood text,
    z_order integer,
    way_area real,
    tags public.hstore,
    way public.geometry(LineString,3857)
);


ALTER TABLE public.planet_osm_line OWNER TO deb;

--
-- Name: planet_osm_nodes; Type: TABLE; Schema: public; Owner: deb
--

CREATE TABLE public.planet_osm_nodes (
    id bigint NOT NULL,
    lat integer NOT NULL,
    lon integer NOT NULL,
    tags jsonb
);


ALTER TABLE public.planet_osm_nodes OWNER TO deb;

--
-- Name: planet_osm_point; Type: TABLE; Schema: public; Owner: deb
--

CREATE TABLE public.planet_osm_point (
    osm_id bigint,
    access text,
    "addr:housename" text,
    "addr:housenumber" text,
    "addr:interpolation" text,
    admin_level text,
    aerialway text,
    aeroway text,
    amenity text,
    area text,
    barrier text,
    bicycle text,
    brand text,
    bridge text,
    boundary text,
    building text,
    capital text,
    construction text,
    covered text,
    culvert text,
    cutting text,
    denomination text,
    disused text,
    ele text,
    embankment text,
    foot text,
    "generator:source" text,
    harbour text,
    highway text,
    historic text,
    horse text,
    intermittent text,
    junction text,
    landuse text,
    layer text,
    leisure text,
    lock text,
    man_made text,
    military text,
    motorcar text,
    name text,
    "natural" text,
    office text,
    oneway text,
    operator text,
    place text,
    population text,
    power text,
    power_source text,
    public_transport text,
    railway text,
    ref text,
    religion text,
    route text,
    service text,
    shop text,
    sport text,
    surface text,
    toll text,
    tourism text,
    "tower:type" text,
    tunnel text,
    water text,
    waterway text,
    wetland text,
    width text,
    wood text,
    z_order integer,
    tags public.hstore,
    way public.geometry(Point,3857)
);


ALTER TABLE public.planet_osm_point OWNER TO deb;

--
-- Name: planet_osm_polygon; Type: TABLE; Schema: public; Owner: deb
--

CREATE TABLE public.planet_osm_polygon (
    osm_id bigint,
    access text,
    "addr:housename" text,
    "addr:housenumber" text,
    "addr:interpolation" text,
    admin_level text,
    aerialway text,
    aeroway text,
    amenity text,
    area text,
    barrier text,
    bicycle text,
    brand text,
    bridge text,
    boundary text,
    building text,
    construction text,
    covered text,
    culvert text,
    cutting text,
    denomination text,
    disused text,
    embankment text,
    foot text,
    "generator:source" text,
    harbour text,
    highway text,
    historic text,
    horse text,
    intermittent text,
    junction text,
    landuse text,
    layer text,
    leisure text,
    lock text,
    man_made text,
    military text,
    motorcar text,
    name text,
    "natural" text,
    office text,
    oneway text,
    operator text,
    place text,
    population text,
    power text,
    power_source text,
    public_transport text,
    railway text,
    ref text,
    religion text,
    route text,
    service text,
    shop text,
    sport text,
    surface text,
    toll text,
    tourism text,
    "tower:type" text,
    tracktype text,
    tunnel text,
    water text,
    waterway text,
    wetland text,
    width text,
    wood text,
    z_order integer,
    way_area real,
    tags public.hstore,
    way public.geometry(Geometry,3857)
);


ALTER TABLE public.planet_osm_polygon OWNER TO deb;

--
-- Name: planet_osm_rels; Type: TABLE; Schema: public; Owner: deb
--

CREATE TABLE public.planet_osm_rels (
    id bigint NOT NULL,
    members jsonb NOT NULL,
    tags jsonb
);


ALTER TABLE public.planet_osm_rels OWNER TO deb;

--
-- Name: planet_osm_roads; Type: TABLE; Schema: public; Owner: deb
--

CREATE TABLE public.planet_osm_roads (
    osm_id bigint,
    access text,
    "addr:housename" text,
    "addr:housenumber" text,
    "addr:interpolation" text,
    admin_level text,
    aerialway text,
    aeroway text,
    amenity text,
    area text,
    barrier text,
    bicycle text,
    brand text,
    bridge text,
    boundary text,
    building text,
    construction text,
    covered text,
    culvert text,
    cutting text,
    denomination text,
    disused text,
    embankment text,
    foot text,
    "generator:source" text,
    harbour text,
    highway text,
    historic text,
    horse text,
    intermittent text,
    junction text,
    landuse text,
    layer text,
    leisure text,
    lock text,
    man_made text,
    military text,
    motorcar text,
    name text,
    "natural" text,
    office text,
    oneway text,
    operator text,
    place text,
    population text,
    power text,
    power_source text,
    public_transport text,
    railway text,
    ref text,
    religion text,
    route text,
    service text,
    shop text,
    sport text,
    surface text,
    toll text,
    tourism text,
    "tower:type" text,
    tracktype text,
    tunnel text,
    water text,
    waterway text,
    wetland text,
    width text,
    wood text,
    z_order integer,
    way_area real,
    tags public.hstore,
    way public.geometry(LineString,3857)
);


ALTER TABLE public.planet_osm_roads OWNER TO deb;

--
-- Name: planet_osm_ways; Type: TABLE; Schema: public; Owner: deb
--

CREATE TABLE public.planet_osm_ways (
    id bigint NOT NULL,
    nodes bigint[] NOT NULL,
    tags jsonb
);


ALTER TABLE public.planet_osm_ways OWNER TO deb;

--
-- Name: user_markers; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_markers (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid,
    title character varying(256) NOT NULL,
    description text,
    icon character varying(64) DEFAULT 'pin'::character varying,
    color character varying(7) DEFAULT '#FF5722'::character varying,
    geom public.geometry(Point,4326) NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.user_markers OWNER TO postgres;

--
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    username character varying(128) NOT NULL,
    email character varying(256) NOT NULL,
    password character varying(256) NOT NULL,
    role character varying(32) DEFAULT 'user'::character varying,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.users OWNER TO postgres;

--
-- Name: analytics_cache id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.analytics_cache ALTER COLUMN id SET DEFAULT nextval('public.analytics_cache_id_seq'::regclass);


--
-- Name: api_logs id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.api_logs ALTER COLUMN id SET DEFAULT nextval('public.api_logs_id_seq'::regclass);


--
-- Name: mandirs id; Type: DEFAULT; Schema: public; Owner: deb
--

ALTER TABLE ONLY public.mandirs ALTER COLUMN id SET DEFAULT nextval('public.mandirs_id_seq'::regclass);


--
-- Name: places id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.places ALTER COLUMN id SET DEFAULT nextval('public.places_id_seq'::regclass);


--
-- Name: analytics_cache analytics_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.analytics_cache
    ADD CONSTRAINT analytics_cache_pkey PRIMARY KEY (id);


--
-- Name: api_logs api_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.api_logs
    ADD CONSTRAINT api_logs_pkey PRIMARY KEY (id);


--
-- Name: favorites favorites_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT favorites_pkey PRIMARY KEY (id);


--
-- Name: geofences geofences_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.geofences
    ADD CONSTRAINT geofences_pkey PRIMARY KEY (id);


--
-- Name: institutions institutions_pkey; Type: CONSTRAINT; Schema: public; Owner: deb
--

ALTER TABLE ONLY public.institutions
    ADD CONSTRAINT institutions_pkey PRIMARY KEY (id);


--
-- Name: mandirs mandirs_pkey; Type: CONSTRAINT; Schema: public; Owner: deb
--

ALTER TABLE ONLY public.mandirs
    ADD CONSTRAINT mandirs_pkey PRIMARY KEY (id);


--
-- Name: mandirs mandirs_sem_id_key; Type: CONSTRAINT; Schema: public; Owner: deb
--

ALTER TABLE ONLY public.mandirs
    ADD CONSTRAINT mandirs_sem_id_key UNIQUE (sem_id);


--
-- Name: osm2pgsql_properties osm2pgsql_properties_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.osm2pgsql_properties
    ADD CONSTRAINT osm2pgsql_properties_pkey PRIMARY KEY (property);


--
-- Name: places places_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.places
    ADD CONSTRAINT places_pkey PRIMARY KEY (id);


--
-- Name: planet_osm_nodes planet_osm_nodes_pkey; Type: CONSTRAINT; Schema: public; Owner: deb
--

ALTER TABLE ONLY public.planet_osm_nodes
    ADD CONSTRAINT planet_osm_nodes_pkey PRIMARY KEY (id);


--
-- Name: planet_osm_rels planet_osm_rels_pkey; Type: CONSTRAINT; Schema: public; Owner: deb
--

ALTER TABLE ONLY public.planet_osm_rels
    ADD CONSTRAINT planet_osm_rels_pkey PRIMARY KEY (id);


--
-- Name: planet_osm_ways planet_osm_ways_pkey; Type: CONSTRAINT; Schema: public; Owner: deb
--

ALTER TABLE ONLY public.planet_osm_ways
    ADD CONSTRAINT planet_osm_ways_pkey PRIMARY KEY (id);


--
-- Name: user_markers user_markers_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_markers
    ADD CONSTRAINT user_markers_pkey PRIMARY KEY (id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- Name: idx_analytics_bbox; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_analytics_bbox ON public.analytics_cache USING gist (bbox);


--
-- Name: idx_analytics_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_analytics_type ON public.analytics_cache USING btree (stat_type);


--
-- Name: idx_favorites_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_favorites_user ON public.favorites USING btree (user_id);


--
-- Name: idx_geofences_active; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_geofences_active ON public.geofences USING btree (is_active);


--
-- Name: idx_geofences_geom; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_geofences_geom ON public.geofences USING gist (geom);


--
-- Name: idx_geofences_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_geofences_user ON public.geofences USING btree (user_id);


--
-- Name: idx_institutions_aishe; Type: INDEX; Schema: public; Owner: deb
--

CREATE INDEX idx_institutions_aishe ON public.institutions USING btree (aishe_id);


--
-- Name: idx_institutions_district; Type: INDEX; Schema: public; Owner: deb
--

CREATE INDEX idx_institutions_district ON public.institutions USING btree (district);


--
-- Name: idx_institutions_geom; Type: INDEX; Schema: public; Owner: deb
--

CREATE INDEX idx_institutions_geom ON public.institutions USING gist (geom);


--
-- Name: idx_institutions_metadata_gin; Type: INDEX; Schema: public; Owner: deb
--

CREATE INDEX idx_institutions_metadata_gin ON public.institutions USING gin (metadata);


--
-- Name: idx_institutions_name_trgm; Type: INDEX; Schema: public; Owner: deb
--

CREATE INDEX idx_institutions_name_trgm ON public.institutions USING gin (name public.gin_trgm_ops);


--
-- Name: idx_institutions_type; Type: INDEX; Schema: public; Owner: deb
--

CREATE INDEX idx_institutions_type ON public.institutions USING btree (type);


--
-- Name: idx_institutions_udise; Type: INDEX; Schema: public; Owner: deb
--

CREATE INDEX idx_institutions_udise ON public.institutions USING btree (udise_code);


--
-- Name: idx_logs_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_logs_created ON public.api_logs USING btree (created_at);


--
-- Name: idx_logs_path; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_logs_path ON public.api_logs USING btree (path);


--
-- Name: idx_mandirs_district; Type: INDEX; Schema: public; Owner: deb
--

CREATE INDEX idx_mandirs_district ON public.mandirs USING btree (district);


--
-- Name: idx_mandirs_geom; Type: INDEX; Schema: public; Owner: deb
--

CREATE INDEX idx_mandirs_geom ON public.mandirs USING gist (geom);


--
-- Name: idx_mandirs_name; Type: INDEX; Schema: public; Owner: deb
--

CREATE INDEX idx_mandirs_name ON public.mandirs USING gin (to_tsvector('english'::regconfig, name));


--
-- Name: idx_mandirs_state; Type: INDEX; Schema: public; Owner: deb
--

CREATE INDEX idx_mandirs_state ON public.mandirs USING btree (state);


--
-- Name: idx_markers_geom; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_markers_geom ON public.user_markers USING gist (geom);


--
-- Name: idx_markers_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_markers_user ON public.user_markers USING btree (user_id);


--
-- Name: idx_places_geom; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_places_geom ON public.places USING gist (geom);


--
-- Name: idx_places_name; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_places_name ON public.places USING gin (to_tsvector('english'::regconfig, (COALESCE(name, ''::character varying))::text));


--
-- Name: idx_places_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_places_type ON public.places USING btree (type);


--
-- Name: idx_users_email; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_users_email ON public.users USING btree (email);


--
-- Name: planet_osm_line_osm_id_idx; Type: INDEX; Schema: public; Owner: deb
--

CREATE INDEX planet_osm_line_osm_id_idx ON public.planet_osm_line USING btree (osm_id);


--
-- Name: planet_osm_line_way_idx; Type: INDEX; Schema: public; Owner: deb
--

CREATE INDEX planet_osm_line_way_idx ON public.planet_osm_line USING gist (way);


--
-- Name: planet_osm_point_osm_id_idx; Type: INDEX; Schema: public; Owner: deb
--

CREATE INDEX planet_osm_point_osm_id_idx ON public.planet_osm_point USING btree (osm_id);


--
-- Name: planet_osm_point_way_idx; Type: INDEX; Schema: public; Owner: deb
--

CREATE INDEX planet_osm_point_way_idx ON public.planet_osm_point USING gist (way);


--
-- Name: planet_osm_polygon_osm_id_idx; Type: INDEX; Schema: public; Owner: deb
--

CREATE INDEX planet_osm_polygon_osm_id_idx ON public.planet_osm_polygon USING btree (osm_id);


--
-- Name: planet_osm_polygon_way_idx; Type: INDEX; Schema: public; Owner: deb
--

CREATE INDEX planet_osm_polygon_way_idx ON public.planet_osm_polygon USING gist (way);


--
-- Name: planet_osm_rels_node_members_idx; Type: INDEX; Schema: public; Owner: deb
--

CREATE INDEX planet_osm_rels_node_members_idx ON public.planet_osm_rels USING gin (public.planet_osm_member_ids(members, 'N'::character(1))) WITH (fastupdate=off);


--
-- Name: planet_osm_rels_way_members_idx; Type: INDEX; Schema: public; Owner: deb
--

CREATE INDEX planet_osm_rels_way_members_idx ON public.planet_osm_rels USING gin (public.planet_osm_member_ids(members, 'W'::character(1))) WITH (fastupdate=off);


--
-- Name: planet_osm_roads_osm_id_idx; Type: INDEX; Schema: public; Owner: deb
--

CREATE INDEX planet_osm_roads_osm_id_idx ON public.planet_osm_roads USING btree (osm_id);


--
-- Name: planet_osm_roads_way_idx; Type: INDEX; Schema: public; Owner: deb
--

CREATE INDEX planet_osm_roads_way_idx ON public.planet_osm_roads USING gist (way);


--
-- Name: planet_osm_ways_nodes_bucket_idx; Type: INDEX; Schema: public; Owner: deb
--

CREATE INDEX planet_osm_ways_nodes_bucket_idx ON public.planet_osm_ways USING gin (public.planet_osm_index_bucket(nodes)) WITH (fastupdate=off);


--
-- Name: planet_osm_line planet_osm_line_osm2pgsql_valid; Type: TRIGGER; Schema: public; Owner: deb
--

CREATE TRIGGER planet_osm_line_osm2pgsql_valid BEFORE INSERT OR UPDATE ON public.planet_osm_line FOR EACH ROW EXECUTE FUNCTION public.planet_osm_line_osm2pgsql_valid();


--
-- Name: planet_osm_point planet_osm_point_osm2pgsql_valid; Type: TRIGGER; Schema: public; Owner: deb
--

CREATE TRIGGER planet_osm_point_osm2pgsql_valid BEFORE INSERT OR UPDATE ON public.planet_osm_point FOR EACH ROW EXECUTE FUNCTION public.planet_osm_point_osm2pgsql_valid();


--
-- Name: planet_osm_polygon planet_osm_polygon_osm2pgsql_valid; Type: TRIGGER; Schema: public; Owner: deb
--

CREATE TRIGGER planet_osm_polygon_osm2pgsql_valid BEFORE INSERT OR UPDATE ON public.planet_osm_polygon FOR EACH ROW EXECUTE FUNCTION public.planet_osm_polygon_osm2pgsql_valid();


--
-- Name: planet_osm_roads planet_osm_roads_osm2pgsql_valid; Type: TRIGGER; Schema: public; Owner: deb
--

CREATE TRIGGER planet_osm_roads_osm2pgsql_valid BEFORE INSERT OR UPDATE ON public.planet_osm_roads FOR EACH ROW EXECUTE FUNCTION public.planet_osm_roads_osm2pgsql_valid();


--
-- Name: institutions trg_set_institutions_updated_at; Type: TRIGGER; Schema: public; Owner: deb
--

CREATE TRIGGER trg_set_institutions_updated_at BEFORE UPDATE ON public.institutions FOR EACH ROW EXECUTE FUNCTION public.set_institutions_updated_at();


--
-- Name: favorites favorites_place_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT favorites_place_id_fkey FOREIGN KEY (place_id) REFERENCES public.places(id) ON DELETE SET NULL;


--
-- Name: favorites favorites_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT favorites_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: geofences geofences_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.geofences
    ADD CONSTRAINT geofences_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_markers user_markers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_markers
    ADD CONSTRAINT user_markers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: pg_database_owner
--

GRANT USAGE ON SCHEMA public TO geoserver_app;


--
-- Name: TABLE analytics_cache; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.analytics_cache TO geosphere;
GRANT SELECT ON TABLE public.analytics_cache TO geoserver_app;


--
-- Name: SEQUENCE analytics_cache_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.analytics_cache_id_seq TO geosphere;
GRANT SELECT ON SEQUENCE public.analytics_cache_id_seq TO geoserver_app;


--
-- Name: TABLE api_logs; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.api_logs TO geosphere;
GRANT SELECT ON TABLE public.api_logs TO geoserver_app;


--
-- Name: SEQUENCE api_logs_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.api_logs_id_seq TO geosphere;
GRANT SELECT ON SEQUENCE public.api_logs_id_seq TO geoserver_app;


--
-- Name: TABLE favorites; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.favorites TO geosphere;
GRANT SELECT ON TABLE public.favorites TO geoserver_app;


--
-- Name: TABLE geofences; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.geofences TO geosphere;
GRANT SELECT ON TABLE public.geofences TO geoserver_app;


--
-- Name: TABLE geography_columns; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.geography_columns TO geosphere;
GRANT SELECT ON TABLE public.geography_columns TO geoserver_app;


--
-- Name: TABLE geometry_columns; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.geometry_columns TO geosphere;
GRANT SELECT ON TABLE public.geometry_columns TO geoserver_app;


--
-- Name: TABLE osm2pgsql_properties; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.osm2pgsql_properties TO geosphere;
GRANT SELECT ON TABLE public.osm2pgsql_properties TO geoserver_app;


--
-- Name: TABLE places; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.places TO geosphere;
GRANT SELECT ON TABLE public.places TO geoserver_app;


--
-- Name: SEQUENCE places_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.places_id_seq TO geosphere;
GRANT SELECT ON SEQUENCE public.places_id_seq TO geoserver_app;


--
-- Name: TABLE planet_osm_line; Type: ACL; Schema: public; Owner: deb
--

GRANT SELECT ON TABLE public.planet_osm_line TO geoserver_app;


--
-- Name: TABLE planet_osm_nodes; Type: ACL; Schema: public; Owner: deb
--

GRANT SELECT ON TABLE public.planet_osm_nodes TO geoserver_app;


--
-- Name: TABLE planet_osm_point; Type: ACL; Schema: public; Owner: deb
--

GRANT SELECT ON TABLE public.planet_osm_point TO geoserver_app;


--
-- Name: TABLE planet_osm_polygon; Type: ACL; Schema: public; Owner: deb
--

GRANT SELECT ON TABLE public.planet_osm_polygon TO geoserver_app;


--
-- Name: TABLE planet_osm_rels; Type: ACL; Schema: public; Owner: deb
--

GRANT SELECT ON TABLE public.planet_osm_rels TO geoserver_app;


--
-- Name: TABLE planet_osm_roads; Type: ACL; Schema: public; Owner: deb
--

GRANT SELECT ON TABLE public.planet_osm_roads TO geoserver_app;


--
-- Name: TABLE planet_osm_ways; Type: ACL; Schema: public; Owner: deb
--

GRANT SELECT ON TABLE public.planet_osm_ways TO geoserver_app;


--
-- Name: TABLE spatial_ref_sys; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.spatial_ref_sys TO geosphere;
GRANT SELECT ON TABLE public.spatial_ref_sys TO geoserver_app;


--
-- Name: TABLE user_markers; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.user_markers TO geosphere;
GRANT SELECT ON TABLE public.user_markers TO geoserver_app;


--
-- Name: TABLE users; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.users TO geosphere;
GRANT SELECT ON TABLE public.users TO geoserver_app;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON SEQUENCES TO geoserver_app;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON TABLES TO geoserver_app;


--
-- PostgreSQL database dump complete
--

\unrestrict NpjwpY8gd34RktcJzPhObaXnK6azdRS6D0Jm5WrlG6OXHjh9ZNw5oCyGdQgknlc

