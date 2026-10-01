CREATE TYPE "public"."address_kind" AS ENUM('eoa', 'contract', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."address_kind_source" AS ENUM('deployment-receipt', 'emitted-log', 'eth_getCode');--> statement-breakpoint
CREATE TYPE "public"."protocol_category" AS ENUM('dex', 'lending', 'wrapper', 'other');--> statement-breakpoint
CREATE TYPE "public"."token_metadata_status" AS ENUM('pending', 'complete', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "public"."token_standard" AS ENUM('erc20', 'erc721', 'erc1155');--> statement-breakpoint
CREATE TABLE "addresses" (
	"chain_id" integer NOT NULL,
	"address" varchar(42) NOT NULL,
	"kind" "address_kind" DEFAULT 'unknown' NOT NULL,
	"kind_source" "address_kind_source",
	"kind_checked_at_block" bigint,
	"first_observed_block" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "addresses_chain_id_address_pk" PRIMARY KEY("chain_id","address"),
	CONSTRAINT "addresses_format" CHECK ("addresses"."address" ~ '^0x[0-9a-f]{40}$')
);
--> statement-breakpoint
CREATE TABLE "blocks" (
	"chain_id" integer NOT NULL,
	"number" bigint NOT NULL,
	"hash" varchar(66) NOT NULL,
	"parent_hash" varchar(66) NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"miner" varchar(42) NOT NULL,
	"gas_used" numeric(78, 0) NOT NULL,
	"gas_limit" numeric(78, 0) NOT NULL,
	"base_fee_per_gas" numeric(78, 0),
	"transaction_count" integer NOT NULL,
	"indexed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blocks_chain_id_number_pk" PRIMARY KEY("chain_id","number"),
	CONSTRAINT "blocks_hash_format" CHECK ("blocks"."hash" ~ '^0x[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "chains" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"is_testnet" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"chain_id" integer NOT NULL,
	"address" varchar(42) NOT NULL,
	"deployer" varchar(42),
	"deployment_transaction_hash" varchar(66),
	"deployment_block" bigint,
	"interfaces" "token_standard"[] DEFAULT '{}' NOT NULL,
	"first_observed_block" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contracts_chain_id_address_pk" PRIMARY KEY("chain_id","address")
);
--> statement-breakpoint
CREATE TABLE "erc1155_transfers" (
	"chain_id" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"log_index" integer NOT NULL,
	"transaction_hash" varchar(66) NOT NULL,
	"token_address" varchar(42) NOT NULL,
	"from_address" varchar(42) NOT NULL,
	"to_address" varchar(42) NOT NULL,
	"batch_index" integer NOT NULL,
	"operator" varchar(42) NOT NULL,
	"token_id" numeric(78, 0) NOT NULL,
	"value" numeric(78, 0) NOT NULL,
	CONSTRAINT "erc1155_transfers_chain_id_block_number_log_index_batch_index_pk" PRIMARY KEY("chain_id","block_number","log_index","batch_index")
);
--> statement-breakpoint
CREATE TABLE "erc721_transfers" (
	"chain_id" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"log_index" integer NOT NULL,
	"transaction_hash" varchar(66) NOT NULL,
	"token_address" varchar(42) NOT NULL,
	"from_address" varchar(42) NOT NULL,
	"to_address" varchar(42) NOT NULL,
	"token_id" numeric(78, 0) NOT NULL,
	CONSTRAINT "erc721_transfers_chain_id_block_number_log_index_pk" PRIMARY KEY("chain_id","block_number","log_index")
);
--> statement-breakpoint
CREATE TABLE "logs" (
	"chain_id" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"log_index" integer NOT NULL,
	"transaction_hash" varchar(66) NOT NULL,
	"address" varchar(42) NOT NULL,
	"topic0" varchar(66),
	"topic1" varchar(66),
	"topic2" varchar(66),
	"topic3" varchar(66),
	"data" text NOT NULL,
	CONSTRAINT "logs_chain_id_block_number_log_index_pk" PRIMARY KEY("chain_id","block_number","log_index")
);
--> statement-breakpoint
CREATE TABLE "protocol_contracts" (
	"chain_id" integer NOT NULL,
	"address" varchar(42) NOT NULL,
	"protocol_id" varchar(64) NOT NULL,
	"role" varchar(64) NOT NULL,
	CONSTRAINT "protocol_contracts_chain_id_address_pk" PRIMARY KEY("chain_id","address")
);
--> statement-breakpoint
CREATE TABLE "protocols" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" "protocol_category" NOT NULL,
	"website" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_state" (
	"chain_id" integer NOT NULL,
	"indexer_id" varchar(64) NOT NULL,
	"last_processed_block" bigint NOT NULL,
	"last_processed_hash" varchar(66) NOT NULL,
	"start_block" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_state_chain_id_indexer_id_pk" PRIMARY KEY("chain_id","indexer_id")
);
--> statement-breakpoint
CREATE TABLE "token_transfers" (
	"chain_id" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"log_index" integer NOT NULL,
	"transaction_hash" varchar(66) NOT NULL,
	"token_address" varchar(42) NOT NULL,
	"from_address" varchar(42) NOT NULL,
	"to_address" varchar(42) NOT NULL,
	"value" numeric(78, 0) NOT NULL,
	CONSTRAINT "token_transfers_chain_id_block_number_log_index_pk" PRIMARY KEY("chain_id","block_number","log_index")
);
--> statement-breakpoint
CREATE TABLE "tokens" (
	"chain_id" integer NOT NULL,
	"address" varchar(42) NOT NULL,
	"standard" "token_standard",
	"name" varchar(128),
	"symbol" varchar(32),
	"decimals" smallint,
	"total_supply" numeric(78, 0),
	"metadata_status" "token_metadata_status" DEFAULT 'pending' NOT NULL,
	"metadata_error" varchar(256),
	"metadata_fetched_at" timestamp with time zone,
	"first_observed_block" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tokens_chain_id_address_pk" PRIMARY KEY("chain_id","address"),
	CONSTRAINT "tokens_decimals_range" CHECK ("tokens"."decimals" IS NULL OR "tokens"."decimals" BETWEEN 0 AND 255)
);
--> statement-breakpoint
CREATE TABLE "transaction_receipts" (
	"chain_id" integer NOT NULL,
	"transaction_hash" varchar(66) NOT NULL,
	"status" smallint NOT NULL,
	"gas_used" numeric(78, 0) NOT NULL,
	"cumulative_gas_used" numeric(78, 0) NOT NULL,
	"effective_gas_price" numeric(78, 0),
	"contract_address" varchar(42),
	"log_count" integer NOT NULL,
	CONSTRAINT "transaction_receipts_chain_id_transaction_hash_pk" PRIMARY KEY("chain_id","transaction_hash"),
	CONSTRAINT "receipts_status_values" CHECK ("transaction_receipts"."status" IN (0, 1))
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"chain_id" integer NOT NULL,
	"hash" varchar(66) NOT NULL,
	"block_number" bigint NOT NULL,
	"transaction_index" integer NOT NULL,
	"from_address" varchar(42) NOT NULL,
	"to_address" varchar(42),
	"value" numeric(78, 0) NOT NULL,
	"nonce" bigint NOT NULL,
	"type" smallint NOT NULL,
	"gas_limit" numeric(78, 0) NOT NULL,
	"gas_price" numeric(78, 0),
	"max_fee_per_gas" numeric(78, 0),
	"max_priority_fee_per_gas" numeric(78, 0),
	"input" text NOT NULL,
	"selector" varchar(10),
	CONSTRAINT "transactions_chain_id_hash_pk" PRIMARY KEY("chain_id","hash")
);
--> statement-breakpoint
CREATE TABLE "wallet_labels" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"address" varchar(42) NOT NULL,
	"label" varchar(128) NOT NULL,
	"category" varchar(64) NOT NULL,
	"source" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_chain_id_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_chain_id_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_chain_id_address_addresses_chain_id_address_fk" FOREIGN KEY ("chain_id","address") REFERENCES "public"."addresses"("chain_id","address") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erc1155_transfers" ADD CONSTRAINT "erc1155_transfers_chain_id_block_number_log_index_logs_chain_id_block_number_log_index_fk" FOREIGN KEY ("chain_id","block_number","log_index") REFERENCES "public"."logs"("chain_id","block_number","log_index") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erc1155_transfers" ADD CONSTRAINT "erc1155_transfers_chain_id_token_address_tokens_chain_id_address_fk" FOREIGN KEY ("chain_id","token_address") REFERENCES "public"."tokens"("chain_id","address") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erc721_transfers" ADD CONSTRAINT "erc721_transfers_chain_id_block_number_log_index_logs_chain_id_block_number_log_index_fk" FOREIGN KEY ("chain_id","block_number","log_index") REFERENCES "public"."logs"("chain_id","block_number","log_index") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erc721_transfers" ADD CONSTRAINT "erc721_transfers_chain_id_token_address_tokens_chain_id_address_fk" FOREIGN KEY ("chain_id","token_address") REFERENCES "public"."tokens"("chain_id","address") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logs" ADD CONSTRAINT "logs_chain_id_transaction_hash_transactions_chain_id_hash_fk" FOREIGN KEY ("chain_id","transaction_hash") REFERENCES "public"."transactions"("chain_id","hash") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protocol_contracts" ADD CONSTRAINT "protocol_contracts_chain_id_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protocol_contracts" ADD CONSTRAINT "protocol_contracts_protocol_id_protocols_id_fk" FOREIGN KEY ("protocol_id") REFERENCES "public"."protocols"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_state" ADD CONSTRAINT "sync_state_chain_id_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_transfers" ADD CONSTRAINT "token_transfers_chain_id_block_number_log_index_logs_chain_id_block_number_log_index_fk" FOREIGN KEY ("chain_id","block_number","log_index") REFERENCES "public"."logs"("chain_id","block_number","log_index") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_transfers" ADD CONSTRAINT "token_transfers_chain_id_token_address_tokens_chain_id_address_fk" FOREIGN KEY ("chain_id","token_address") REFERENCES "public"."tokens"("chain_id","address") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tokens" ADD CONSTRAINT "tokens_chain_id_address_contracts_chain_id_address_fk" FOREIGN KEY ("chain_id","address") REFERENCES "public"."contracts"("chain_id","address") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_receipts" ADD CONSTRAINT "transaction_receipts_chain_id_transaction_hash_transactions_chain_id_hash_fk" FOREIGN KEY ("chain_id","transaction_hash") REFERENCES "public"."transactions"("chain_id","hash") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_chain_id_block_number_blocks_chain_id_number_fk" FOREIGN KEY ("chain_id","block_number") REFERENCES "public"."blocks"("chain_id","number") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_labels" ADD CONSTRAINT "wallet_labels_chain_id_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "addresses_first_observed_idx" ON "addresses" USING btree ("chain_id","first_observed_block");--> statement-breakpoint
CREATE UNIQUE INDEX "blocks_chain_hash_uq" ON "blocks" USING btree ("chain_id","hash");--> statement-breakpoint
CREATE INDEX "blocks_chain_timestamp_idx" ON "blocks" USING btree ("chain_id","timestamp");--> statement-breakpoint
CREATE INDEX "contracts_chain_deployer_idx" ON "contracts" USING btree ("chain_id","deployer") WHERE "contracts"."deployer" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "contracts_first_observed_idx" ON "contracts" USING btree ("chain_id","first_observed_block");--> statement-breakpoint
CREATE INDEX "erc1155_transfers_from_idx" ON "erc1155_transfers" USING btree ("chain_id","from_address","block_number");--> statement-breakpoint
CREATE INDEX "erc1155_transfers_to_idx" ON "erc1155_transfers" USING btree ("chain_id","to_address","block_number");--> statement-breakpoint
CREATE INDEX "erc1155_transfers_token_idx" ON "erc1155_transfers" USING btree ("chain_id","token_address","token_id");--> statement-breakpoint
CREATE INDEX "erc721_transfers_from_idx" ON "erc721_transfers" USING btree ("chain_id","from_address","block_number");--> statement-breakpoint
CREATE INDEX "erc721_transfers_to_idx" ON "erc721_transfers" USING btree ("chain_id","to_address","block_number");--> statement-breakpoint
CREATE INDEX "erc721_transfers_token_idx" ON "erc721_transfers" USING btree ("chain_id","token_address","token_id");--> statement-breakpoint
CREATE INDEX "logs_chain_tx_idx" ON "logs" USING btree ("chain_id","transaction_hash");--> statement-breakpoint
CREATE INDEX "logs_chain_address_idx" ON "logs" USING btree ("chain_id","address","block_number");--> statement-breakpoint
CREATE INDEX "logs_chain_topic0_idx" ON "logs" USING btree ("chain_id","topic0");--> statement-breakpoint
CREATE INDEX "protocol_contracts_protocol_idx" ON "protocol_contracts" USING btree ("protocol_id");--> statement-breakpoint
CREATE INDEX "token_transfers_from_idx" ON "token_transfers" USING btree ("chain_id","from_address","block_number");--> statement-breakpoint
CREATE INDEX "token_transfers_to_idx" ON "token_transfers" USING btree ("chain_id","to_address","block_number");--> statement-breakpoint
CREATE INDEX "token_transfers_token_idx" ON "token_transfers" USING btree ("chain_id","token_address","block_number");--> statement-breakpoint
CREATE INDEX "tokens_metadata_pending_idx" ON "tokens" USING btree ("chain_id","first_observed_block") WHERE "tokens"."metadata_status" = 'pending';--> statement-breakpoint
CREATE INDEX "receipts_chain_contract_idx" ON "transaction_receipts" USING btree ("chain_id","contract_address") WHERE "transaction_receipts"."contract_address" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_chain_block_position_uq" ON "transactions" USING btree ("chain_id","block_number","transaction_index");--> statement-breakpoint
CREATE INDEX "transactions_chain_from_idx" ON "transactions" USING btree ("chain_id","from_address","block_number","transaction_index");--> statement-breakpoint
CREATE INDEX "transactions_chain_to_idx" ON "transactions" USING btree ("chain_id","to_address","block_number","transaction_index");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_labels_unique" ON "wallet_labels" USING btree ("chain_id","address","label","source");--> statement-breakpoint
CREATE INDEX "wallet_labels_address_idx" ON "wallet_labels" USING btree ("chain_id","address");