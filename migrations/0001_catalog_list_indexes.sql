CREATE INDEX `product_categories_category_idx` ON `product_categories` (`category_id`,`product_id`);--> statement-breakpoint
CREATE INDEX `products_status_title_idx` ON `products` (`status`,"title" COLLATE NOCASE,`id`);--> statement-breakpoint
CREATE INDEX `products_title_idx` ON `products` ("title" COLLATE NOCASE,`id`);