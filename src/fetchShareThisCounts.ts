import { z } from "zod";

const ShareSchema = z.object({
  all: z.number().optional(),
  email: z.number().optional(),
  facebook: z.number().optional(),
  instapaper: z.number().optional(),
  mail_ru: z.number().optional(),
  pinterest: z.number().optional(),
  print: z.number().optional(),
  twitter: z.number().optional(),
  whatsapp: z.number().optional(),
  xing: z.number().optional(),
  linkedin: z.number().optional(),
  reddit: z.number().optional(),
  telegram: z.number().optional(),
  tumblr: z.number().optional(),
  vk: z.number().optional(),
  wechat: z.number().optional(),
  buffer: z.number().optional(),
  messenger: z.number().optional(),
  line: z.number().optional(),
  pocket: z.number().optional(),
  sms: z.number().optional(),
  hackernews: z.number().optional(),
  blogger: z.number().optional(),
  delicious: z.number().optional(),
  digg: z.number().optional(),
  stumbleupon: z.number().optional(),
  googlebookmarks: z.number().optional(),
})

/**
 * Zod schema for ShareThis counts response.
 */
const ShareThisCountsSchema = z.object({
  clicks: ShareSchema,
  total: z.number(),
  shares: ShareSchema.optional(),
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
  console.log(url);
  const endpoint = `https://count-server.sharethis.com/v2.0/get_counts?url=${encodeURIComponent(
    url
  )}`;
  const res = await fetch(endpoint);
  if (!res.ok) throw new Error("Failed to fetch ShareThis counts");
  const data = await res.json();

  console.log(data);
  return ShareThisCountsSchema.parse(data);
}
