import { z } from "zod";

/**
 * Zod schema for ShareThis counts response.
 */
const ShareThisCountsSchema = z.object({
  clicks: z.object({
    all: z.number(),
    facebook: z.number().optional(),
    github: z.number().optional(),
    twitter: z.number().optional(),
  }),
  total: z.number(),
  shares: z
    .object({
      all: z.number(),
      email: z.number(),
      facebook: z.number(),
      instapaper: z.number(),
      mail_ru: z.number(),
      pinterest: z.number(),
      print: z.number(),
      twitter: z.number(),
      whatsapp: z.number(),
      xing: z.number(),
    })
    .optional(),
  ourl: z.string().url(),
});

type ShareThisCounts = z.infer<typeof ShareThisCountsSchema>;

/**
 * Fetches and validates social share counts for a given URL from ShareThis.
 * @param {string} url - The URL to fetch share counts for.
 * @returns {Promise<ShareThisCounts>} - A promise that resolves to the validated share counts data.
 * @throws {Error} - Throws if the fetch fails, returns a non-OK response, or fails validation.
 */
export async function fetchShareThisCounts(
  url: string
): Promise<ShareThisCounts> {
  const endpoint = `https://count-server.sharethis.com/v2.0/get_counts?url=${encodeURIComponent(
    url
  )}`;
  const res = await fetch(endpoint);
  if (!res.ok) throw new Error("Failed to fetch ShareThis counts");
  const data = await res.json();

  console.log(data);
  return ShareThisCountsSchema.parse(data);
}
