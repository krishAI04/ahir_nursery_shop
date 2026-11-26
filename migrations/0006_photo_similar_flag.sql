ALTER TABLE `product_images` ADD `similar` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `product_images` SET `similar` = 1 WHERE `product_id` IN (SELECT `id` FROM `products` WHERE `representative_photo` = 1);
