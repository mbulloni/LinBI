CREATE DATABASE IF NOT EXISTS vendite;
CREATE TABLE vendite.ordini (id UInt64, prodotto LowCardinality(String), data Date, creato DateTime64(3), importo Decimal(18,2), sconto Nullable(Float64), attivo Bool, note Nullable(String)) ENGINE = MergeTree ORDER BY id;
INSERT INTO vendite.ordini SELECT number + 1, ['Bici', 'Casco', 'Città ⛰'][number % 3 + 1], toDate('2023-01-01') + number % 900, toDateTime64('2024-01-01 00:00:00', 3) + number, (number + 1) * 1.5, if(number % 3 = 0, NULL, 0.1), number % 2 = 0, if(number % 100 = 0, concat('nota ', toString(number)), NULL) FROM numbers(300000);
CREATE VIEW vendite.per_prodotto AS SELECT prodotto, count() AS ordini, sum(importo) AS totale FROM vendite.ordini GROUP BY prodotto;
