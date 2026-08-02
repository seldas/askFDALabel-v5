import psycopg2
import os

def get_rld_setids(db_url):
    try:
        # Establish a connection to the database
        conn = psycopg2.connect(db_url)
        cur = conn.cursor()

        # SQL query to retrieve set_ids where is_rld is True
        query = "SELECT set_id FROM labeling.sum_spl WHERE is_rld = 1 AND revised_date > '2026-01-01';"

        # Execute the query
        cur.execute(query)

        # Fetch all results
        set_ids = cur.fetchall()

        # Close the cursor and connection
        cur.close()
        conn.close()

        return set([set_id[0] for set_id in set_ids])

    except psycopg2.Error as e:
        print(f"Error: {e}")
        return []

def write_rld_list(set_ids, output_file):
    with open(output_file, 'w') as f:
        for set_id in set_ids:
            f.write(f"{set_id}\n")

if __name__ == "__main__":
    db_url = os.environ.get('DATABASE_URL', 'postgresql://afd_user:afd_password@localhost:5432/askfdalabel')
    output_file = 'scripts/evaluation/rld_list.txt'
    rld_set_ids = get_rld_setids(db_url)
    write_rld_list(rld_set_ids, output_file)
    print(f"RLD set_ids written to {output_file}")