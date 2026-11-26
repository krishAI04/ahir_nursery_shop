CREATE TABLE `catalog_version` (
	`id` integer PRIMARY KEY NOT NULL,
	`token` text NOT NULL
);
--> statement-breakpoint
-- Hand-written below: the public product list caches its id lists per Worker and reuses them while this token is unchanged.
-- A random token (not a counter) never repeats, even after a database restore.
INSERT INTO `catalog_version` (`id`, `token`) VALUES (1, lower(hex(randomblob(8))));
--> statement-breakpoint
CREATE TRIGGER `catalog_version_product_ins` AFTER INSERT ON `products` BEGIN UPDATE `catalog_version` SET `token` = lower(hex(randomblob(8))) WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER `catalog_version_product_del` AFTER DELETE ON `products` BEGIN UPDATE `catalog_version` SET `token` = lower(hex(randomblob(8))) WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER `catalog_version_product_upd` AFTER UPDATE OF `status`, `title` ON `products` BEGIN UPDATE `catalog_version` SET `token` = lower(hex(randomblob(8))) WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER `catalog_version_pc_ins` AFTER INSERT ON `product_categories` BEGIN UPDATE `catalog_version` SET `token` = lower(hex(randomblob(8))) WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER `catalog_version_pc_del` AFTER DELETE ON `product_categories` BEGIN UPDATE `catalog_version` SET `token` = lower(hex(randomblob(8))) WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER `catalog_version_pc_upd` AFTER UPDATE ON `product_categories` BEGIN UPDATE `catalog_version` SET `token` = lower(hex(randomblob(8))) WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER `catalog_version_cat_ins` AFTER INSERT ON `categories` BEGIN UPDATE `catalog_version` SET `token` = lower(hex(randomblob(8))) WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER `catalog_version_cat_del` AFTER DELETE ON `categories` BEGIN UPDATE `catalog_version` SET `token` = lower(hex(randomblob(8))) WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER `catalog_version_cat_upd` AFTER UPDATE ON `categories` BEGIN UPDATE `catalog_version` SET `token` = lower(hex(randomblob(8))) WHERE `id` = 1; END;
