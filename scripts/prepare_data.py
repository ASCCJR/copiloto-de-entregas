"""Prepare the dashboard dataset from the public Olist archive."""
import argparse
import csv
import hashlib
import io
import json
import urllib.request
import zipfile
from datetime import date
from pathlib import Path

DOWNLOAD = "https://www.kaggle.com/api/v1/datasets/download/olistbr/brazilian-ecommerce"
SOURCE = "https://www.kaggle.com/datasets/olistbr/brazilian-ecommerce"
DESTINATION = Path(__file__).resolve().parents[1] / "data" / "deliveries.json"


def read_csv(archive, name):
    with archive.open(name) as binary, io.TextIOWrapper(binary, encoding="utf-8-sig") as text:
        yield from csv.DictReader(text)


def prepare(payload):
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        states = {
            row["customer_id"]: row["customer_state"]
            for row in read_csv(archive, "olist_customers_dataset.csv")
        }
        deliveries = []
        total_orders = 0
        for order in read_csv(archive, "olist_orders_dataset.csv"):
            total_orders += 1
            state = states.get(order["customer_id"])
            promised = order["order_estimated_delivery_date"][:10]
            delivered = order["order_delivered_customer_date"][:10]
            if order["order_status"] != "delivered" or not all((state, promised, delivered)):
                continue
            days = (date.fromisoformat(delivered) - date.fromisoformat(promised)).days
            deliveries.append([order["order_id"], state, promised, delivered, days])

    deliveries.sort(key=lambda row: (row[3], row[0]), reverse=True)
    return {
        "source": SOURCE,
        "archiveSha256": hashlib.sha256(payload).hexdigest(),
        "sourceOrders": total_orders,
        "firstDelivery": deliveries[-1][3],
        "lastDelivery": deliveries[0][3],
        "deliveries": deliveries,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, help="Caminho de um ZIP original já baixado")
    args = parser.parse_args()
    if args.archive:
        payload = args.archive.read_bytes()
    else:
        with urllib.request.urlopen(DOWNLOAD, timeout=60) as response:
            payload = response.read()
    snapshot = prepare(payload)
    DESTINATION.parent.mkdir(parents=True, exist_ok=True)
    temp = DESTINATION.with_suffix(".tmp")
    temp.write_text(json.dumps(snapshot, separators=(",", ":")), encoding="utf-8")
    temp.replace(DESTINATION)
    print(f"Pedidos na fonte: {snapshot['sourceOrders']:,}")
    print(f"Entregas elegíveis: {len(snapshot['deliveries']):,}")
    print(f"Período da entrega: {snapshot['firstDelivery']} a {snapshot['lastDelivery']}")
    maranhao = [row for row in snapshot["deliveries"] if row[1] == "MA"]
    print(f"Maranhão: {sum(row[4] > 0 for row in maranhao)} atrasos em {len(maranhao)} entregas.")


if __name__ == "__main__":
    main()
