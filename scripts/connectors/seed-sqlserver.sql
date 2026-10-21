-- Test database for the SQL Server connector (docker: mcr.microsoft.com/mssql/server:2022-latest, see README.md here).
CREATE DATABASE Vendite;
GO
USE Vendite;
GO
CREATE SCHEMA sales;
GO
CREATE TABLE dbo.Prodotti (Id INT PRIMARY KEY, Nome NVARCHAR(100) NOT NULL, Categoria NVARCHAR(50), Prezzo DECIMAL(18,4), Listino MONEY, Attivo BIT, Codice UNIQUEIDENTIFIER, Foto VARBINARY(MAX));
INSERT INTO dbo.Prodotti VALUES
 (1, N'Bicicletta città', N'Strada', 199.9900, 210.50, 1, NEWID(), 0x0102),
 (2, N'Mountain bike ⛰', N'Montagna', 899.5000, 950.00, 1, NEWID(), NULL),
 (3, N'Monopattino', NULL, NULL, NULL, 0, NULL, NULL),
 (4, N'Casco «Pro» 日本', N'Accessori', 49.0000, 55.00, 1, NEWID(), NULL);
CREATE TABLE sales.Ordini (Id BIGINT PRIMARY KEY, ProdottoId INT, Data DATE, Ora TIME, Creato DATETIME2(3), Quantita SMALLINT, Importo FLOAT, Sconto REAL, Note NVARCHAR(MAX), Cliente VARCHAR(40));
WITH n AS (SELECT TOP 200000 ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS k FROM sys.all_objects a CROSS JOIN sys.all_objects b)
INSERT INTO sales.Ordini SELECT k, (k % 4) + 1, DATEADD(day, k % 900, '2023-01-01'), CAST(DATEADD(second, k % 86400, 0) AS TIME), DATEADD(millisecond, k * 1000, '2024-01-01'), k % 10, k * 1.5, CASE WHEN k % 3 = 0 THEN NULL ELSE 0.1 END, CASE WHEN k % 100 = 0 THEN N'nota ' + CAST(k AS NVARCHAR(20)) END, 'cliente ' + CAST(k % 5000 AS VARCHAR(10)) FROM n;
GO
CREATE VIEW sales.VenditePerProdotto AS SELECT p.Nome, SUM(o.Importo) AS Totale, COUNT(*) AS Ordini FROM sales.Ordini o JOIN dbo.Prodotti p ON p.Id = o.ProdottoId GROUP BY p.Nome;
GO
CREATE LOGIN lettore WITH PASSWORD = 'Rd!Acc3ss_2026'; CREATE USER lettore FOR LOGIN lettore; ALTER ROLE db_datareader ADD MEMBER lettore;
GO
SELECT COUNT(*) AS righe, SUM(Importo) AS importo FROM sales.Ordini;
