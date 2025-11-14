import pandas as pd
import os

# The directory where your files are stored
directory = '/Users/michaelbrancazio/Downloads/Takeout 2/Fitbit/Heart Rate Variability'

# Pattern to match in the file names
pattern = 'Heart Rate Variability Details'

# Initialize an empty list to store the dataframes
dataframes = []

# Loop through the files in the directory
for filename in os.listdir(directory):
    if filename.startswith(pattern) and filename.endswith('.csv'):
        # Construct the full file path
        file_path = os.path.join(directory, filename)
        # Read the CSV file and append it to the list
        df = pd.read_csv(file_path)
        dataframes.append(df)

# Concatenate all the dataframes in the list
combined_df = pd.concat(dataframes, ignore_index=True)

# Optional: save the combined dataframe to a new CSV file
output_file = os.path.join(directory, 'Combined_Heart_Rate_Variability_Details.csv')
combined_df.to_csv(output_file, index=False)

print(f"Combined data saved to {output_file}")
