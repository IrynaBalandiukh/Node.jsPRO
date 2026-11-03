CREATE ROLE marketplace_app WITH LOGIN PASSWORD 'changeme_local_dev_password';

ALTER DATABASE marketplace OWNER TO marketplace_app;
