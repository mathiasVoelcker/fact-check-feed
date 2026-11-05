CREATE TYPE "public"."rating_category" AS ENUM('false', 'misleading', 'mixed', 'true', 'unproven', 'unclassifiable');--> statement-breakpoint
CREATE TABLE "claims" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "claims_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"url" text NOT NULL,
	"claim_text" text NOT NULL,
	"rating_text" text NOT NULL,
	"publisher" text NOT NULL,
	"published_on" date NOT NULL,
	"source_id" text NOT NULL,
	"category" "rating_category" NOT NULL,
	"severity" real,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claims_url_unique" UNIQUE("url")
);
--> statement-breakpoint
CREATE TABLE "rating_classifications" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rating_classifications_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"rating_text" text NOT NULL,
	"category" "rating_category" NOT NULL,
	"severity" real,
	"classified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"classifier_version" text NOT NULL,
	CONSTRAINT "rating_classifications_rating_text_unique" UNIQUE("rating_text")
);
