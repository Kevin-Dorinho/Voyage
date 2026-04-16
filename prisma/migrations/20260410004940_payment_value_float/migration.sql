/*
  Warnings:

  - You are about to alter the column `value` on the `payments` table. The data in that column could be lost. The data in that column will be cast from `Int` to `Float`.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_payments" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "company_id" INTEGER NOT NULL,
    "toDate" DATETIME NOT NULL,
    "dueDate" DATETIME NOT NULL,
    "value" REAL NOT NULL,
    "paymentForm" TEXT NOT NULL,
    "advertising" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "creatAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "payments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_payments" ("advertising", "company_id", "creatAt", "dueDate", "id", "key", "paymentForm", "toDate", "type", "updatedAt", "value") SELECT "advertising", "company_id", "creatAt", "dueDate", "id", "key", "paymentForm", "toDate", "type", "updatedAt", "value" FROM "payments";
DROP TABLE "payments";
ALTER TABLE "new_payments" RENAME TO "payments";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
