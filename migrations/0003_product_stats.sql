CREATE TABLE `product_stats` (
	`id` integer PRIMARY KEY NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`published` integer DEFAULT 0 NOT NULL,
	`draft` integer DEFAULT 0 NOT NULL,
	`needs_photo` integer DEFAULT 0 NOT NULL,
	`similar` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
-- Hand-written below: fill the row from today's data, then triggers keep it current for every writer (admin, import, scripts).
INSERT INTO `product_stats` (`id`, `total`, `published`, `draft`, `needs_photo`, `similar`)
SELECT 1, COUNT(*), COALESCE(SUM(`status` = 'published'), 0), COALESCE(SUM(`status` = 'draft'), 0),
  COALESCE(SUM(NOT EXISTS (SELECT 1 FROM `product_images` i WHERE i.`product_id` = p.`id`)), 0), COALESCE(SUM(`representative_photo` = 1), 0)
FROM `products` p;
--> statement-breakpoint
CREATE TRIGGER `product_stats_product_ins` AFTER INSERT ON `products` BEGIN
  UPDATE `product_stats` SET `total` = `total` + 1, `published` = `published` + (NEW.`status` = 'published'), `draft` = `draft` + (NEW.`status` = 'draft'),
    `needs_photo` = `needs_photo` + NOT EXISTS (SELECT 1 FROM `product_images` WHERE `product_id` = NEW.`id`), `similar` = `similar` + (NEW.`representative_photo` = 1)
  WHERE `id` = 1;
END;
--> statement-breakpoint
CREATE TRIGGER `product_stats_product_del` AFTER DELETE ON `products` BEGIN
  UPDATE `product_stats` SET `total` = `total` - 1, `published` = `published` - (OLD.`status` = 'published'), `draft` = `draft` - (OLD.`status` = 'draft'),
    `needs_photo` = `needs_photo` - NOT EXISTS (SELECT 1 FROM `product_images` WHERE `product_id` = OLD.`id`), `similar` = `similar` - (OLD.`representative_photo` = 1)
  WHERE `id` = 1;
END;
--> statement-breakpoint
CREATE TRIGGER `product_stats_product_upd` AFTER UPDATE OF `status`, `representative_photo` ON `products` BEGIN
  UPDATE `product_stats` SET `published` = `published` + (NEW.`status` = 'published') - (OLD.`status` = 'published'),
    `draft` = `draft` + (NEW.`status` = 'draft') - (OLD.`status` = 'draft'),
    `similar` = `similar` + (NEW.`representative_photo` = 1) - (OLD.`representative_photo` = 1)
  WHERE `id` = 1;
END;
--> statement-breakpoint
CREATE TRIGGER `product_stats_image_ins` AFTER INSERT ON `product_images`
WHEN (SELECT COUNT(*) FROM `product_images` WHERE `product_id` = NEW.`product_id`) = 1 AND EXISTS (SELECT 1 FROM `products` WHERE `id` = NEW.`product_id`) BEGIN
  UPDATE `product_stats` SET `needs_photo` = `needs_photo` - 1 WHERE `id` = 1;
END;
--> statement-breakpoint
CREATE TRIGGER `product_stats_image_del` AFTER DELETE ON `product_images`
WHEN NOT EXISTS (SELECT 1 FROM `product_images` WHERE `product_id` = OLD.`product_id`) AND EXISTS (SELECT 1 FROM `products` WHERE `id` = OLD.`product_id`) BEGIN
  UPDATE `product_stats` SET `needs_photo` = `needs_photo` + 1 WHERE `id` = 1;
END;
--> statement-breakpoint
CREATE TRIGGER `product_stats_image_move` AFTER UPDATE OF `product_id` ON `product_images` WHEN NEW.`product_id` <> OLD.`product_id` BEGIN
  UPDATE `product_stats` SET `needs_photo` = `needs_photo`
    + (NOT EXISTS (SELECT 1 FROM `product_images` WHERE `product_id` = OLD.`product_id`) AND EXISTS (SELECT 1 FROM `products` WHERE `id` = OLD.`product_id`))
    - ((SELECT COUNT(*) FROM `product_images` WHERE `product_id` = NEW.`product_id`) = 1 AND EXISTS (SELECT 1 FROM `products` WHERE `id` = NEW.`product_id`))
  WHERE `id` = 1;
END;
